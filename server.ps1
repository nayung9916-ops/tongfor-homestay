# ==============================================================================
# Tongfor Homestay PMS Backend Server (server.ps1)
# Features: Dashboard Server, Agoda iCal Synchronization, iCal Export Feed
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataFile = Join-Path $ScriptDir "data\database.json"
$PublicDir = Join-Path $ScriptDir "public"
$Port = 3000

# Find available port
while ($true) {
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$Port/")
        $listener.Prefixes.Add("http://127.0.0.1:$Port/")
        $listener.Start()
        break
    }
    catch {
        $Port++
        if ($Port -gt 3010) {
            Write-Error "Cannot start server on ports 3000-3010"
            exit 1
        }
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Tongfor Homestay PMS Server is RUNNING!" -ForegroundColor Green
Write-Host "  URL: http://localhost:$Port" -ForegroundColor Yellow
Write-Host "  (Press Ctrl + C to stop the server)" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# Read database JSON
function Get-Db {
    if (Test-Path $DataFile) {
        $raw = [System.IO.File]::ReadAllText($DataFile, [System.Text.Encoding]::UTF8)
        return ConvertFrom-Json $raw
    }
    return @{ property_name = "Tongfor Homestay"; rooms = @(); bookings = @(); agoda_events = @() }
}

# Save database JSON
function Save-Db ($db) {
    $json = ConvertTo-Json $db -Depth 10
    [System.IO.File]::WriteAllText($DataFile, $json, [System.Text.Encoding]::UTF8)
}

# Sync Agoda iCal
function Sync-AgodaCalendar ($roomId, $url) {
    if ([string]::IsNullOrWhiteSpace($url)) { return @() }
    
    try {
        Write-Host "[Agoda Sync] Fetching room $roomId from Agoda..." -ForegroundColor Cyan
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = [System.Text.Encoding]::UTF8
        $content = $wc.DownloadString($url)
        
        $events = @()
        $inEvent = $false
        $curStart = ""
        $curEnd = ""
        $curUid = ""
        $curSummary = "Agoda Booking"
        
        $lines = $content -split "`r?`n"
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ($trimmed -eq "BEGIN:VEVENT") {
                $inEvent = $true
                $curStart = ""
                $curEnd = ""
                $curUid = [System.Guid]::NewGuid().ToString()
                $curSummary = "Agoda Booking"
            }
            elseif ($trimmed -eq "END:VEVENT") {
                if ($inEvent -and $curStart -and $curEnd) {
                    $events += @{
                        id = "agoda-$curUid"
                        room_id = "$roomId"
                        uid = $curUid
                        check_in = $curStart
                        check_out = $curEnd
                        summary = $curSummary
                        source = "agoda"
                        guest_name = "Agoda Guest"
                        phone = "-"
                        price = 0
                        paid_status = "paid"
                    }
                }
                $inEvent = $false
            }
            elseif ($inEvent) {
                if ($trimmed.StartsWith("DTSTART")) {
                    $val = $trimmed.Substring($trimmed.IndexOf(":") + 1).Trim()
                    if ($val.Length -ge 8) {
                        $curStart = "$($val.Substring(0,4))-$($val.Substring(4,2))-$($val.Substring(6,2))"
                    }
                }
                elseif ($trimmed.StartsWith("DTEND")) {
                    $val = $trimmed.Substring($trimmed.IndexOf(":") + 1).Trim()
                    if ($val.Length -ge 8) {
                        $curEnd = "$($val.Substring(0,4))-$($val.Substring(4,2))-$($val.Substring(6,2))"
                    }
                }
                elseif ($trimmed.StartsWith("UID:")) {
                    $curUid = $trimmed.Substring(4).Trim()
                }
                elseif ($trimmed.StartsWith("SUMMARY")) {
                    $curSummary = $trimmed.Substring($trimmed.IndexOf(":") + 1).Trim()
                }
            }
        }
        
        Write-Host "[Agoda Sync] Room $roomId synced! Found $($events.Count) bookings." -ForegroundColor Green
        return $events
    }
    catch {
        Write-Host "[Agoda Sync] Error syncing room ${roomId}: $_" -ForegroundColor Red
        return @()
    }
}

# Export iCal (.ics) for a room
function Generate-IcalForRoom ($roomId, $db) {
    $room = $db.rooms | Where-Object { "$($_.id)" -eq "$roomId" } | Select-Object -First 1
    $roomName = if ($room) { $room.name } else { "Room $roomId" }
    
    # Only export manual bookings (Facebook, Walk-in, direct) so Agoda blocks them
    $manualBookings = $db.bookings | Where-Object { "$($_.room_id)" -eq "$roomId" -and $_.source -ne "agoda" }
    
    $nowStr = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("BEGIN:VCALENDAR")
    [void]$sb.AppendLine("VERSION:2.0")
    [void]$sb.AppendLine("PRODID:-//Tongfor Homestay//PMS 1.0//EN")
    [void]$sb.AppendLine("CALSCALE:GREGORIAN")
    [void]$sb.AppendLine("METHOD:PUBLISH")
    [void]$sb.AppendLine("X-WR-CALNAME:Tongfor Homestay - $roomName")
    
    foreach ($b in $manualBookings) {
        $dtStart = ($b.check_in -replace '-', '')
        $dtEnd = ($b.check_out -replace '-', '')
        $uid = if ($b.id) { $b.id } else { [System.Guid]::NewGuid().ToString() }
        
        [void]$sb.AppendLine("BEGIN:VEVENT")
        [void]$sb.AppendLine("UID:booking-$uid@tongfor")
        [void]$sb.AppendLine("DTSTAMP:$nowStr")
        [void]$sb.AppendLine("DTSTART;VALUE=DATE:$dtStart")
        [void]$sb.AppendLine("DTEND;VALUE=DATE:$dtEnd")
        [void]$sb.AppendLine("SUMMARY:BOOKED - $($b.source) - $($b.guest_name)")
        [void]$sb.AppendLine("DESCRIPTION:Phone: $($b.phone)")
        [void]$sb.AppendLine("STATUS:CONFIRMED")
        [void]$sb.AppendLine("END:VEVENT")
    }
    
    [void]$sb.AppendLine("END:VCALENDAR")
    return $sb.ToString()
}

# Initial sync on startup
try {
    $initDb = Get-Db
    $allAgodaEvents = @()
    foreach ($r in $initDb.rooms) {
        if ($r.agoda_ical_url) {
            $evs = Sync-AgodaCalendar -roomId $r.id -url $r.agoda_ical_url
            $allAgodaEvents += $evs
            $r.last_synced = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
    $initDb.agoda_events = $allAgodaEvents
    Save-Db $initDb
} catch {
    Write-Host "[Init] Startup sync warning: $_" -ForegroundColor Yellow
}

# Main HTTP Request Loop
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # CORS Headers
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
        
        $rawPath = $request.Url.AbsolutePath
        $method = $request.HttpMethod
        
        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        # 1. API: Get Current Status
        if ($method -eq "GET" -and $rawPath -eq "/api/status") {
            $db = Get-Db
            $json = ConvertTo-Json $db -Depth 10
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }
        
        # 2. API: Trigger Agoda Sync
        if ($method -eq "POST" -and $rawPath -eq "/api/sync") {
            $db = Get-Db
            $allAgodaEvents = @()
            foreach ($r in $db.rooms) {
                if ($r.agoda_ical_url) {
                    $evs = Sync-AgodaCalendar -roomId $r.id -url $r.agoda_ical_url
                    $allAgodaEvents += $evs
                    $r.last_synced = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                }
            }
            $db.agoda_events = $allAgodaEvents
            Save-Db $db
            
            $resObj = @{ success = $true; message = "Sync complete"; count = $allAgodaEvents.Count; db = $db }
            $json = ConvertTo-Json $resObj -Depth 10
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }
        
        # 3. API: Create Manual Booking
        if ($method -eq "POST" -and $rawPath -eq "/api/bookings") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $newBooking = ConvertFrom-Json $body
            
            $db = Get-Db
            if (-not $newBooking.id) {
                $newBooking | Add-Member -MemberType NoteProperty -Name "id" -Value ("bk-" + (Get-Date).Ticks)
            }
            if (-not $newBooking.created_at) {
                $newBooking | Add-Member -MemberType NoteProperty -Name "created_at" -Value ((Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"))
            }
            
            $existing = @($db.bookings)
            $existing += $newBooking
            $db.bookings = $existing
            Save-Db $db
            
            $resObj = @{ success = $true; booking = $newBooking }
            $json = ConvertTo-Json $resObj -Depth 5
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }
        
        # 4. API: Delete Booking
        if ($method -eq "DELETE" -and $rawPath -eq "/api/bookings") {
            $id = $request.QueryString["id"]
            if (-not $id) {
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                if ($body) {
                    $parsed = ConvertFrom-Json $body
                    $id = $parsed.id
                }
            }
            
            $db = Get-Db
            $filtered = @($db.bookings | Where-Object { "$($_.id)" -ne "$id" })
            $db.bookings = $filtered
            Save-Db $db
            
            $resObj = @{ success = $true; message = "Booking deleted" }
            $json = ConvertTo-Json $resObj -Depth 5
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }
        
        # 5. API: Save Room Settings & Agoda URLs
        if ($method -eq "POST" -and $rawPath -eq "/api/settings") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $settings = ConvertFrom-Json $body
            
            $db = Get-Db
            if ($settings.rooms) {
                $db.rooms = $settings.rooms
            }
            if ($settings.property_name) {
                $db.property_name = $settings.property_name
            }
            Save-Db $db
            
            $resObj = @{ success = $true; message = "Settings updated" }
            $json = ConvertTo-Json $resObj -Depth 5
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }
        
        # 6. API: iCal Feed Export for Agoda
        if ($method -eq "GET" -and ($rawPath -like "/api/ical*")) {
            $roomId = $request.QueryString["room"]
            if (-not $roomId) {
                if ($rawPath -match '/api/ical/([^.]+)\.ics') {
                    $roomId = $Matches[1]
                }
            }
            if (-not $roomId) { $roomId = "101" }
            
            $db = Get-Db
            $icsContent = Generate-IcalForRoom -roomId $roomId -db $db
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($icsContent)
            $response.ContentType = "text/calendar; charset=utf-8"
            $response.AddHeader("Content-Disposition", "inline; filename=`"$roomId.ics`"")
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }
        
        # 7. Static Files (HTML / JS / CSS)
        $filePath = Join-Path $PublicDir "index.html"
        if ($rawPath -ne "/" -and $rawPath -ne "") {
            $relPath = $rawPath.TrimStart("/").Replace("/", "\")
            $candidate = Join-Path $PublicDir $relPath
            if (Test-Path $candidate) {
                $filePath = $candidate
            }
        }
        
        if (Test-Path $filePath) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = "text/html; charset=utf-8"
            switch ($ext) {
                ".js"   { $mime = "application/javascript; charset=utf-8" }
                ".css"  { $mime = "text/css; charset=utf-8" }
                ".json" { $mime = "application/json; charset=utf-8" }
                ".png"  { $mime = "image/png" }
                ".svg"  { $mime = "image/svg+xml" }
            }
            
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $mime
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
        }
        else {
            $response.StatusCode = 404
            $response.Close()
        }
    }
    catch {
        Write-Host "Request error: $_" -ForegroundColor Red
        try {
            $response.StatusCode = 500
            $response.Close()
        } catch {}
    }
}
