# Checks that every PowerShell script vmlab sends to a Windows machine at least PARSES, so a typo is found now and not
# 30 minutes into a paid run. It cannot run them: that needs Windows. Used by `just lint-ps` (docs/05-install.md).
# Reads /w (the repo) and scratch/gen-*.ps1 (the scripts written in TypeScript, dumped by the recipe).
$files = @(Get-ChildItem /w/config -Recurse -Filter *.ps1) + @(Get-ChildItem /w/scratch -Filter gen-*.ps1)
$bad = 0
foreach ($f in $files) {
  $errs = $null; $tok = $null
  [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tok, [ref]$errs) | Out-Null
  $name = $f.FullName.Replace('/w/', '')
  if ($errs.Count) { $bad++; "SYNTAX ERRORS in $name"; foreach ($e in $errs) { "  line $($e.Extent.StartLineNumber): $($e.Message)" } } else { "ok  $name" }
}
"files: $($files.Count), with errors: $bad"
