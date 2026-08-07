param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw "Diary source file was not found: $InputPath"
}

$content = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8)
$headingPattern = '(?m)^(?:(?<year>2010)\u5e74)?(?<month>\d{1,2})\u6708(?<day>\d{1,2})\u65e5?\s+\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]\s*$'
$matches = [regex]::Matches($content, $headingPattern)

if ($matches.Count -ne 19) {
  throw "Expected 19 diary headings, but found $($matches.Count)."
}

$entries = for ($index = 0; $index -lt $matches.Count; $index += 1) {
  $heading = $matches[$index]
  $month = [int]$heading.Groups['month'].Value
  $day = [int]$heading.Groups['day'].Value
  $date = "2010-{0:D2}-{1:D2}" -f $month, $day
  [void][datetime]::ParseExact($date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)

  $bodyStart = $heading.Index + $heading.Length
  $bodyEnd = if ($index + 1 -lt $matches.Count) { $matches[$index + 1].Index } else { $content.Length }
  $bodyText = $content.Substring($bodyStart, $bodyEnd - $bodyStart).Trim()

  if ([string]::IsNullOrWhiteSpace($bodyText)) {
    throw "Diary entry $date has no body text."
  }

  $paragraphs = @([regex]::Split($bodyText, '(?:\r?\n){2,}') | ForEach-Object {
    $lines = @([regex]::Split($_.Trim(), '\r?\n') | ForEach-Object {
      [System.Net.WebUtility]::HtmlEncode($_.Trim())
    } | Where-Object { $_ -ne '' })

    if ($lines.Count -gt 0) {
      '<p>' + ($lines -join '<br>') + '</p>'
    }
  })

  $diaryLabel = @([char]0x65E5, [char]0x8BB0) -join ''
  $dailyLabel = @([char]0x65E5, [char]0x5E38) -join ''
  $title = @(
    [char]0x300A, '2010', [char]0x5E74, $month, [char]0x6708, $day,
    [char]0x65E5, ' ', $diaryLabel, [char]0x300B
  ) -join ''
  $imageAlt = @(
    '2010', [char]0x5E74, $month, [char]0x6708, $day, [char]0x65E5,
    $diaryLabel, [char]0x914D, [char]0x56FE
  ) -join ''

  [PSCustomObject][ordered]@{
    id = "diary-$date"
    date = $date
    title = $title
    body = ($paragraphs -join '')
    images = @(
      [PSCustomObject][ordered]@{
        src = 'assets/posts/diary-2010-cover.jpg'
        thumb = 'assets/thumbs/diary-2010-cover.jpg'
        alt = $imageAlt
      }
    )
    tags = @($diaryLabel, $dailyLabel)
    source = ''
    notion = ''
    favorite = $false
    deletedAt = $null
  }
}

$entries = @($entries | Sort-Object date -Descending)
$duplicateDates = @($entries | Group-Object date | Where-Object Count -gt 1)
if ($duplicateDates.Count -gt 0) {
  throw "Duplicate diary dates found: $($duplicateDates.Name -join ', ')"
}

$javascript = 'window.BLOG_DIARIES_2010 = ' + ($entries | ConvertTo-Json -Depth 8) + ';' + [Environment]::NewLine
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, $javascript, $utf8WithoutBom)

Write-Output "Generated $($entries.Count) diary entries in descending date order."
