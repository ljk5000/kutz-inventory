# Rebuild the multi-size Windows icon from the approved retriever artwork. No extra tools needed.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../companion/Assets'))
$source = [Drawing.Image]::FromFile((Join-Path $assetDirectory 'retriever.png'))
$frames = @()
try {
    foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)) {
        $bitmap = New-Object Drawing.Bitmap($size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb))
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $png = New-Object IO.MemoryStream
        try {
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($source, (New-Object Drawing.Rectangle(0, 0, $size, $size)))
            $bitmap.Save($png, [Drawing.Imaging.ImageFormat]::Png)
            $frames += [PSCustomObject]@{ Size = $size; Bytes = $png.ToArray() }
        } finally { $png.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $source.Dispose() }
$file = [IO.File]::Create((Join-Path $assetDirectory 'Companion.ico'))
$writer = New-Object IO.BinaryWriter($file)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
Write-Output 'Built Companion.ico: 16, 20, 24, 32, 40, 48, 64, 96, 128, 256 px.'
