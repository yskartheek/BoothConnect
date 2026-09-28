# #44: Roll imports, opening a batch and uploading PDFs or ZIPs

**Issue:** https://github.com/yskartheek/BoothConnect/issues/44
**What changed:**

- **Open a batch:** an admin picks the level they're uploading for (State,
  PC, AC or Part), inside their own area only.
- **Upload PDFs, or ZIPs of PDFs:** files go straight to the private file
  store (MinIO locally), in pieces, without passing through the API.
- **Finish an upload:** the server checks each file:
  - it has the size it was said to have;
  - it is really a PDF, or a readable ZIP.

  It then records a fingerprint (SHA-256) of each PDF, and each PDF becomes
  one file in the batch:
  - A ZIP of 3 PDFs becomes **3 files**. Anything else in the ZIP is listed
    as skipped.
  - The same PDF uploaded again (same fingerprint) is marked **duplicate**
    and not processed again.

- A **Part** batch takes exactly one PDF.
- Volunteers can't do any of this (**403**). An admin can't upload for
  another area (**404**).
- Reading the PDFs (extraction) comes in #45. For now files wait in status
  `uploaded`.
- **Use test files only. Never upload real electoral rolls.**

## Steps

1. Prepare as usual (branch `claude/issue-44-import-uploads`, then
   `pnpm infra:up`, which also starts MinIO and creates the bucket,
   `db:deploy`, `db:seed`, `pnpm --filter api dev`, with
   `OTP_DEV_MODE=true`), and paste the `SignIn` helper from the #36 guide
   into a second PowerShell window.
2. Make a small test PDF (not a real roll):
   ```powershell
   $pdf = [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n% test file $(Get-Random)`n%%EOF`n")
   [IO.File]::WriteAllBytes("$PWD\test-roll.pdf", $pdf)
   ```
3. As the **admin**, open a batch for your AC:
   ```powershell
   $ad = SignIn "+919999900001"
   $ac = (Invoke-RestMethod "$api/me" -Headers $ad).assignments[0].node.id
   $batch = Invoke-RestMethod "$api/imports/batches" -Method Post -Headers ($ad + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body (@{ targetNodeId = $ac } | ConvertTo-Json) -ContentType "application/json"
   $batch | Select-Object id, status
   ```
   **Expect:** a batch ID and status `uploading`.
4. Ask for upload URLs, upload the file, then finish:
   ```powershell
   $size = (Get-Item test-roll.pdf).Length
   $t = (Invoke-RestMethod "$api/imports/batches/$($batch.id)/files" -Method Post -Headers ($ad + @{ "Idempotency-Key" = [guid]::NewGuid().ToString() }) -Body (@{ files = @(@{ name = "test-roll.pdf"; sizeBytes = $size }) } | ConvertTo-Json -Depth 4) -ContentType "application/json").uploads[0]
   $put = Invoke-WebRequest $t.parts[0].url -Method Put -InFile test-roll.pdf
   $parts = @(@{ partNumber = 1; etag = $put.Headers["ETag"] })
   $done = Invoke-RestMethod "$api/imports/batches/$($batch.id)/files/$($t.id)/complete" -Method Post -Headers $ad -Body (@{ parts = $parts } | ConvertTo-Json -Depth 4) -ContentType "application/json"
   $done.files | Format-Table originalName, status, sizeBytes
   ```
   **Expect:** one file, status `uploaded`.
5. Repeat step 4 with the same file.
   **Expect:** status `duplicate`.
6. Optional: open the MinIO console (http://localhost:9001, user
   `boothconnect`) and look in the `boothconnect-imports` bucket under
   `imports/`.
7. As **volunteer A**, try step 3.
   **Expect:** `403 Forbidden`.
8. Run the tests (MinIO must be running):
   ```powershell
   pnpm --filter api test:int
   ```
   **Expect:** all pass, including "import batches and uploads". They
   cover the ZIP of 3 PDFs, duplicates, part-level rules, size checks and
   other areas.

## Pass criteria

- Steps 3–8 give the expected results.

## Known issues and notes

- The admin web's upload screen comes in the web epic. These steps do by
  hand what the browser will do.
- Big ZIPs are unpacked while you wait for step 4's last call. If that
  becomes slow for a whole AC, it will move to a background job.
