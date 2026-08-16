# matdemctl.ps1 - MatDEM GUI automation primitives for the DSH MatDEM plugin.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File matdemctl.ps1 <cmd> [args...]
# Commands:
#   win                - list all top-level windows whose process name is MatDEM (JSON)
#   fg <hwnd>          - restore + foreground the given window
#   top <hwnd>         - pin window to TOPMOST (blocks other topmost windows)
#   untop <hwnd>       - release TOPMOST pin
#   min <hwnd>         - minimize a window
#   rect <hwnd>        - print "x,y,w,h" of the window's screen rect
#   shot <png> <hwnd>  - screenshot the window client area into png (1x)
#   ocr <png> [scale]  - OCR a png, print one JSON line per text line {t,x,y,w,h};
#                        scale (default 1) upscales before recognition, coords stay in original px
#   click <x> <y>      - move the mouse and left-click at screen coords
#   dblclick <x> <y>   - double left-click
#   pclick <hwnd> <wx> <wy> - PostMessage click (window-rect coords, bypasses Z-order occlusion)
#   type <text>        - type text (UTF-16 unicode keystrokes) into the focused window
#   key <name>         - send special keys: enter tab esc f5 home end up down left right ctrl+a ctrl+s ...
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Cmd,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Args
)

$ErrorActionPreference = 'Stop'

# ---------- native interop ----------
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class MDWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  public static string[] List() {
    var list = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      RECT r; GetWindowRect(h, out r);
      list.Add(h.ToString() + "|" + IsWindowVisible(h) + "|" + c + "|" + t + "|" + r.Left + "|" + r.Top + "|" + (r.Right - r.Left) + "|" + (r.Bottom - r.Top));
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }

  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); // LEFTDOWN
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); // LEFTUP
  }

  // Bring a window to the front reliably: topmost-toggle works from a
  // background process where SetForegroundWindow is blocked.
  public static void ToFront(IntPtr h) {
    ShowWindow(h, 9);
    SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_TOPMOST
    System.Threading.Thread.Sleep(120);
    SetWindowPos(h, (IntPtr)(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_NOTOPMOST
    SetForegroundWindow(h);
  }

  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

  // Temporarily pin a window to TOPMOST so clicks/screenshots are not
  // swallowed by other topmost windows (e.g. fullscreen browsers).
  public static void Top(IntPtr h) {
    SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_TOPMOST
  }

  public static void UnTop(IntPtr h) {
    SetWindowPos(h, (IntPtr)(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_NOTOPMOST
  }

  public static void Min(IntPtr h) {
    ShowWindow(h, 6); // SW_MINIMIZE
  }

  public static bool IsMinimized(IntPtr h) {
    return IsIconic(h);
  }

  // PostMessage mouse click directly to a window: bypasses Z-order occlusion.
  // Takes window-client coordinates; converts them from window-rect coords.
  public static void PClick(IntPtr h, int wx, int wy) {
    // wx, wy are relative to the window rect (same space as shot coordinates).
    // Convert to client coordinates via the client-area origin on screen.
    POINT origin = new POINT(); origin.X = 0; origin.Y = 0;
    ClientToScreen(h, ref origin);
    RECT r; GetWindowRect(h, out r);
    int lparamX = r.Left + wx - origin.X;
    int lparamY = r.Top + wy - origin.Y;
    IntPtr lParam = (IntPtr)((lparamY << 16) | (lparamX & 0xFFFF));
    PostMessage(h, 0x0201, (IntPtr)1, lParam); // WM_LBUTTONDOWN
    System.Threading.Thread.Sleep(60);
    PostMessage(h, 0x0202, (IntPtr)0, lParam); // WM_LBUTTONUP
  }

  public static void Wheel(int x, int y, int clicks) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(80);
    uint delta = (uint)(120 * clicks);
    mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero); // MOUSEEVENTF_WHEEL
  }

  public static void DblClick(int x, int y) {
    Click(x, y);
    System.Threading.Thread.Sleep(120);
    Click(x, y);
  }
}

public class MDKeys {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public InputUnion U;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern ushort VkKeyScan(char ch);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  // Post WM_CHAR / WM_KEYDOWN+WM_KEYUP directly to a window: Java AWT ignores
  // SendInput, but consumes window-message keyboard input.
  public static void WType(IntPtr h, string text) {
    foreach (char ch in text) {
      PostMessage(h, 0x0102, (IntPtr)ch, (IntPtr)1); // WM_CHAR
      System.Threading.Thread.Sleep(15);
    }
  }

  public static void WKey(IntPtr h, string name) {
    Action<ushort> down = (vk) => { PostMessage(h, 0x0100, (IntPtr)vk, (IntPtr)1); System.Threading.Thread.Sleep(15); };
    Action<ushort> up = (vk) => { PostMessage(h, 0x0101, (IntPtr)vk, (IntPtr)1); System.Threading.Thread.Sleep(15); };
    string n = name.ToLowerInvariant();
    switch (n) {
      case "enter": down(0x0D); up(0x0D); break;
      case "tab": down(0x09); up(0x09); break;
      case "esc": down(0x1B); up(0x1B); break;
      case "backspace": down(0x08); up(0x08); break;
      case "delete": down(0x2E); up(0x2E); break;
      case "home": down(0x24); up(0x24); break;
      case "end": down(0x23); up(0x23); break;
      case "up": down(0x26); up(0x26); break;
      case "down": down(0x28); up(0x28); break;
      case "ctrl+a": down(0x11); down(0x41); up(0x41); up(0x11); break;
      case "ctrl+c": down(0x11); down(0x43); up(0x43); up(0x11); break;
      case "ctrl+v": down(0x11); down(0x56); up(0x56); up(0x11); break;
      case "ctrl+s": down(0x11); down(0x53); up(0x53); up(0x11); break;
      case "ctrl+enter": down(0x11); down(0x0D); up(0x0D); up(0x11); break;
      default: throw new Exception("unknown wkey: " + name);
    }
  }

  public static void TypeText(string text) {
    var list = new List<INPUT>();
    foreach (char ch in text) {
      ushort vk = VkKeyScan(ch);
      // unicode keystroke (works for CJK)
      list.Add(MakeKey(0, (ushort)ch, 0x0004)); // KEYEVENTF_UNICODE
      list.Add(MakeKey(0, (ushort)ch, 0x0004 | 0x0002)); // + KEYUP
    }
    SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Key(string name) {
    var list = new List<INPUT>();
    Action<ushort, bool> push = (vk, down) => {
      list.Add(MakeKey(vk, 0, down ? 0u : 0x0002u));
    };
    string n = name.ToLowerInvariant();
    switch (n) {
      case "enter": push(0x0D, true); push(0x0D, false); break;
      case "tab": push(0x09, true); push(0x09, false); break;
      case "esc": push(0x1B, true); push(0x1B, false); break;
      case "f5": push(0x74, true); push(0x74, false); break;
      case "home": push(0x24, true); push(0x24, false); break;
      case "end": push(0x23, true); push(0x23, false); break;
      case "up": push(0x26, true); push(0x26, false); break;
      case "down": push(0x28, true); push(0x28, false); break;
      case "left": push(0x25, true); push(0x25, false); break;
      case "right": push(0x27, true); push(0x27, false); break;
      case "backspace": push(0x08, true); push(0x08, false); break;
      case "delete": push(0x2E, true); push(0x2E, false); break;
      case "space": push(0x20, true); push(0x20, false); break;
      case "ctrl+a": push(0x11, true); push(0x41, true); push(0x41, false); push(0x11, false); break;
      case "ctrl+s": push(0x11, true); push(0x53, true); push(0x53, false); push(0x11, false); break;
      case "ctrl+v": push(0x11, true); push(0x56, true); push(0x56, false); push(0x11, false); break;
      case "ctrl+enter": push(0x11, true); push(0x0D, true); push(0x0D, false); push(0x11, false); break;
      default: throw new Exception("unknown key: " + name);
    }
    SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT)));
  }

  static INPUT MakeKey(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT();
    i.type = 1; // INPUT_KEYBOARD
    i.U.ki = new KEYBDINPUT();
    i.U.ki.wVk = vk;
    i.U.ki.wScan = scan;
    i.U.ki.dwFlags = flags;
    i.U.ki.time = 0;
    i.U.ki.dwExtraInfo = IntPtr.Zero;
    return i;
  }
}
"@

# DPI awareness so coordinates match the screen
[MDWin]::SetProcessDPIAware() | Out-Null

function Write-Json($obj) {
  $obj | ConvertTo-Json -Compress -Depth 6
}

switch ($Cmd) {
  'win' {
    $matdem = Get-Process -Name 'MatDEM' -ErrorAction SilentlyContinue
    if (-not $matdem) { Write-Json @(); break }
    $pids = @($matdem | ForEach-Object { $_.Id })
    $filtered = @()
    foreach ($line in [MDWin]::List()) {
      $parts = $line.Split('|')
      $h = [IntPtr][int64]$parts[0]
      $pid2 = 0
      [MDWin]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
      if ($pids -contains [int]$pid2) {
        $filtered += [PSCustomObject]@{
          hwnd = [int64]$parts[0]
          visible = ($parts[1] -eq 'True')
          cls = $parts[2]
          title = $parts[3]
          x = [int]$parts[4]; y = [int]$parts[5]; w = [int]$parts[6]; h = [int]$parts[7]
        }
      }
    }
    Write-Json $filtered
  }
  'fg' {
    $h = [IntPtr][int64]$Args[0]
    [MDWin]::ToFront($h)
    Write-Output 'ok'
  }
  'top' {
    # top <hwnd> - pin window to TOPMOST (blocks other topmost windows)
    $h = [IntPtr][int64]$Args[0]
    [MDWin]::Top($h)
    Write-Output 'ok'
  }
  'untop' {
    # untop <hwnd> - release TOPMOST pin
    $h = [IntPtr][int64]$Args[0]
    [MDWin]::UnTop($h)
    Write-Output 'ok'
  }
  'min' {
    # min <hwnd> - minimize a window
    $h = [IntPtr][int64]$Args[0]
    [MDWin]::Min($h)
    Write-Output 'ok'
  }
  'pclick' {
    # pclick <hwnd> <wx> <wy> - PostMessage click (window-rect coords, bypasses Z-order)
    $h = [IntPtr][int64]$Args[0]
    [MDWin]::PClick($h, [int]$Args[1], [int]$Args[2])
    Write-Output 'ok'
  }
  'rect' {
    $h = [IntPtr][int64]$Args[0]
    $r = New-Object MDWin+RECT
    [MDWin]::GetWindowRect($h, [ref]$r) | Out-Null
    Write-Output "$($r.Left),$($r.Top),$($r.Right - $r.Left),$($r.Bottom - $r.Top)"
  }
  'shot' {
    $png = $Args[0]
    $h = [IntPtr][int64]$Args[1]
    $parent = Split-Path $png -Parent
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $r = New-Object MDWin+RECT
    [MDWin]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap($w, $ht)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
    $g.Dispose()
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "$($r.Left),$($r.Top),$w,$ht"
  }
  'ocr' {
    # ocr <png> [scale] - OCR a png; scale (default 1) upscales before recognition.
    # Output coordinates are in ORIGINAL png pixels regardless of scale.
    $png = $Args[0]
    $scale = 1
    if ($Args.Count -ge 2) { $scale = [int]$Args[1]; if ($scale -lt 1) { $scale = 1 } }
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await($WinRtTask, $ResultType) {
      $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
      $netTask = $asTask.Invoke($null, @($WinRtTask))
      $netTask.Wait(-1) | Out-Null
      $netTask.Result
    }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    if ($scale -gt 1) {
      $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
      $transform.ScaledWidth = [uint32]($decoder.PixelWidth * $scale)
      $transform.ScaledHeight = [uint32]($decoder.PixelHeight * $scale)
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync($decoder.BitmapPixelFormat, $decoder.BitmapAlphaMode, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'zh-Hans-CN'))
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $out = @()
    foreach ($line in $result.Lines) {
      $words = @($line.Words)
      if ($words.Count -eq 0) { continue }
      $rect = $words[0].BoundingRect
      $ws = @()
      foreach ($wd in $words) { $ws += $wd.Text }
      $out += [PSCustomObject]@{
        t = ($ws -join ' ')
        x = [int]($rect.X / $scale); y = [int]($rect.Y / $scale)
        w = [int]($rect.Width / $scale); h = [int]($rect.Height / $scale)
      }
    }
    Write-Json $out
  }
  'click' {
    [MDWin]::Click([int]$Args[0], [int]$Args[1])
    Write-Output 'ok'
  }
  'wheel' {
    # wheel <x> <y> <clicks>  (positive = scroll up / away)
    [MDWin]::Wheel([int]$Args[0], [int]$Args[1], [int]$Args[2])
    Write-Output 'ok'
  }
  'dblclick' {
    [MDWin]::DblClick([int]$Args[0], [int]$Args[1])
    Write-Output 'ok'
  }
  'type' {
    [MDKeys]::TypeText($Args[0])
    Write-Output 'ok'
  }
  'clip' {
    # clip <text>  - put text on the Windows clipboard (for Ctrl+V pasting)
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Clipboard]::SetText($Args[0])
    Write-Output 'ok'
  }
  'paste' {
    # paste - send Ctrl+V to the focused window
    [MDKeys]::Key('ctrl+v')
    Write-Output 'ok'
  }
  'key' {
    [MDKeys]::Key($Args[0])
    Write-Output 'ok'
  }
  'wtype' {
    # wtype <hwnd> <text> - type text into a window via WM_CHAR (Java AWT compatible)
    [MDKeys]::WType([IntPtr][int64]$Args[0], $Args[1])
    Write-Output 'ok'
  }
  'wkey' {
    # wkey <hwnd> <name> - send a key to a window via WM_KEYDOWN/UP (Java AWT compatible)
    [MDKeys]::WKey([IntPtr][int64]$Args[0], $Args[1])
    Write-Output 'ok'
  }
  'files' {
    # files <dir> - list regular files with mtime as unix seconds (JSON)
    $d = $Args[0]
    $out = @()
    if (Test-Path $d) {
      Get-ChildItem $d -File -ErrorAction SilentlyContinue | ForEach-Object {
        $out += [PSCustomObject]@{ name = $_.Name; size = $_.Length; mtime = [int64](($_.LastWriteTime - [datetime]'1970-01-01').TotalSeconds) }
      }
    }
    Write-Json $out
  }
  default {
    Write-Error "unknown command: $Cmd"
    exit 1
  }
}
