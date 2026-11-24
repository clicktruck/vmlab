import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRunAsUserScript,
  CREATE_USER_SCRIPT,
  inputsJson,
  SIGN_IN_SCRIPT,
  safeName,
} from './windows-user-task.ts';

test('the step script travels inside the wrapper as base64, so no quote in it can break the wrapper', () => {
  const nasty = `Write-Output 'it''s "quoted" $x \`n @' ; "@`;
  const wrapper = buildRunAsUserScript('01-a b.ps1', nasty);
  const b64 = /\$ScriptB64 = '([^']+)'/.exec(wrapper)?.[1] ?? '';
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), nasty);
  assert.match(wrapper, /\$ScriptName = '01-a_b\.ps1'/, 'the file name is made safe');
});

test('the wrapper registers a task for the account with its password, so the profile is loaded, and cleans up', () => {
  const w = buildRunAsUserScript('a.ps1', 'x');
  assert.match(w, /Register-ScheduledTask .*-User \$account -Password \$Pw -RunLevel Limited/);
  assert.match(w, /Unregister-ScheduledTask/);
  assert.match(w, /Remove-Item \$dir -Recurse/);
  assert.match(w, /exit \$code/);
  // The step runs in a fresh PowerShell, so its exit code is what a plain step gives.
  assert.match(w, /& powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/);
  // The password and the inputs are parameters, never text in the script. The password is optional only because a
  // session step needs none.
  assert.match(w, /param\(\[Parameter\(Mandatory\)\]\[string\]\$Name, \[string\]\$Pw = ''/);
});

test('the account is a member of Users only and may log on as a batch job', () => {
  assert.match(CREATE_USER_SCRIPT, /S-1-5-32-545/);
  assert.match(CREATE_USER_SCRIPT, /SeBatchLogonRight/);
  assert.equal(/Administrators|S-1-5-32-544/.test(CREATE_USER_SCRIPT), false, 'never an administrator');
});

test('inputs go as one JSON object of strings, and a file name loses anything unsafe', () => {
  assert.deepEqual(JSON.parse(inputsJson({ A: '1' }, { B: 'two' })), { A: '1', B: 'two' });
  assert.equal(safeName('../x y.ps1'), '.._x_y.ps1');
});

test('regular expressions survive the trip into the script (run 10 lost its backslashes and printed "logon type ?")', () => {
  const w = buildRunAsUserScript('a.ps1', 'x');
  assert.ok(w.includes(String.raw`'Logon Type:\s+(\d+)'`), 'the logon-type pattern keeps \\s and \\d');
  assert.ok(w.includes(String.raw`-replace '\s+', ' '`));
  assert.ok(CREATE_USER_SCRIPT.includes(String.raw`'^SeBatchLogonRight\s*='`));
  // Nothing that looks like a pattern with its backslash eaten.
  assert.equal(/:s\+\(|\(d\+\)/.test(w), false);
});

test('no task setting is left to a default that can hold a task back, and a task that never starts fails in a minute', () => {
  const w = buildRunAsUserScript('a.ps1', 'x');
  assert.match(
    w,
    /New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable/,
  );
  assert.match(w, /-MultipleInstances IgnoreNew/);
  assert.match(w, /-ExecutionTimeLimit \(New-TimeSpan -Seconds \(\$TimeoutSeconds \+ 30\)\)/);
  assert.match(w, /Register-ScheduledTask .*-Settings \$settings .*-User \$account -Password \$Pw/);
  assert.match(w, /TotalSeconds -ge 60/);
  assert.match(w, /never started/);
  // "Started" is seeing the task run or the runner's own mark, never just "not queued": a task reads Ready before it begins.
  assert.match(w, /\$state -eq 'Running' -or \(Test-Path "\$dir\\started\.txt"\)/);
  assert.match(w, /\$done = \$started -and \(\$state -eq 'Ready'\)/);
  assert.match(w, /Set-Content -Path "\$d\\started\.txt"/);
  // The Task Scheduler's own log is switched on before the task starts, and read when it does not.
  assert.ok(w.indexOf('wevtutil.exe sl') < w.indexOf('.RunEx('));
  // Started with "ignore the conditions" (flag 2): client Windows otherwise holds the task until someone signs in.
  assert.match(w, /GetFolder\('\\'\)\.GetTask\(\$task\)\.RunEx\(\$null, 2, 0, \$null\)/);
  assert.equal(w.includes('Start-ScheduledTask'), false);
  assert.match(w, /Microsoft-Windows-TaskScheduler\/Operational/);
});

test('in a session the task runs inside the signed-in account, with no stored password, after waiting for its desktop', () => {
  const w = buildRunAsUserScript('a.ps1', 'x', 'session');
  assert.match(w, /New-ScheduledTaskPrincipal -UserId \$account -LogonType Interactive -RunLevel Limited/);
  assert.match(w, /Register-ScheduledTask .*-Principal \$principal/);
  assert.equal(/-Password \$Pw/.test(w), false);
  assert.match(w, /Get-Process explorer -IncludeUserName/);
  assert.match(w, /is not signed in at the screen after 300 seconds/);
  // The background kind is unchanged.
  const b = buildRunAsUserScript('a.ps1', 'x');
  assert.match(b, /-User \$account -Password \$Pw -RunLevel Limited/);
  assert.equal(
    b.includes(
      'Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | Where-Object { $_.UserName -eq $account }',
    ),
    false,
  );
});

test('the sign-in script sets Windows to sign the account in by itself, and takes the password as a parameter', () => {
  assert.match(SIGN_IN_SCRIPT, /AutoAdminLogon/);
  assert.match(
    SIGN_IN_SCRIPT,
    /param\(\[Parameter\(Mandatory\)\]\[string\]\$Name, \[Parameter\(Mandatory\)\]\[string\]\$Pw\)/,
  );
  assert.ok(SIGN_IN_SCRIPT.includes(String.raw`HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`));
});
