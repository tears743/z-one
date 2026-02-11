
param (
    [string]$Target = "Active", # "Active" or "Desktop"
    [int]$Depth = 5,
    [string]$OutputFile = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$source = @"
using System;
using System.Runtime.InteropServices;
public class User32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@
Add-Type -TypeDefinition $source -Language CSharp

function Get-ElementTree {
    param (
        [System.Windows.Automation.AutomationElement]$Element,
        [int]$Depth = 3
    )

    if ($null -eq $Element) { return $null }

    $info = @{
        "Name" = ""
        "ControlType" = ""
        "ClassName" = ""
        "AutomationId" = ""
        "BoundingRectangle" = $null
        "IsEnabled" = $false
        "IsVisible" = $false
        "IsActive" = $false
        "Children" = @()
    }

    try { $info["Name"] = $Element.Current.Name } catch {}
    try { $info["ControlType"] = $Element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") } catch {}
    try { $info["ClassName"] = $Element.Current.ClassName } catch {}
    try { $info["AutomationId"] = $Element.Current.AutomationId } catch {}
    try { 
        $rect = $Element.Current.BoundingRectangle
        if ([double]::IsInfinity($rect.X) -or [double]::IsInfinity($rect.Y) -or [double]::IsInfinity($rect.Width) -or [double]::IsInfinity($rect.Height)) {
             $info["BoundingRectangle"] = $null
        } else {
             $info["BoundingRectangle"] = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }
        }
    } catch {}
    try { $info["IsEnabled"] = $Element.Current.IsEnabled } catch {}
    # IsOffscreen is the inverse of IsVisible essentially
    try { $info["IsVisible"] = -not $Element.Current.IsOffscreen } catch {}
    
    # Check if this element corresponds to the foreground window
    try {
        if ($Element.Current.NativeWindowHandle -ne 0 -and $Element.Current.NativeWindowHandle -eq $global:ForegroundHandle) {
            $info["IsActive"] = $true
        }
    } catch {}

    if ($Depth -gt 0) {
        $condition = [System.Windows.Automation.Condition]::TrueCondition
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        $child = $walker.GetFirstChild($Element)

        while ($child -ne $null) {
            $childNode = Get-ElementTree -Element $child -Depth ($Depth - 1)
            if ($childNode -ne $null) {
                $info["Children"] += $childNode
            }
            $child = $walker.GetNextSibling($child)
        }
    }

    return $info
}

try {
    $root = $null
    $global:ForegroundHandle = [User32]::GetForegroundWindow()
    
    if ($Target -eq "Desktop") {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
    } else {
        $handle = [User32]::GetForegroundWindow()
        if ($handle -eq [IntPtr]::Zero) {
            Write-Output "{}"
            exit
        }
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    }

    if ($null -eq $root) {
        Write-Output "{}"
        exit
    }

    $tree = Get-ElementTree -Element $root -Depth $Depth
    
    $json = $tree | ConvertTo-Json -Depth 20 -Compress
    
    if ($OutputFile -ne "") {
        $json | Set-Content -Path $OutputFile -Encoding UTF8
    } else {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $json
    }
} catch {
    Write-Error $_.Exception.Message
}
