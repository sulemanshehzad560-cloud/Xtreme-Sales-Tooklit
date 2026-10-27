XTREME v1.25 - ONE APP FOR QUOTES, INVOICES, CONTRACTS, RECEIPTS AND COC
=======================================================================

This replaces the Xtreme Sales Toolkit on the SAME Netlify site and the SAME
GitHub repository (xtreme-sales-toolkit). The COC site can be retired afterwards.
Your existing users, Zoho WorkDrive connection and saved quotations/invoices carry over.
The Android app keeps working: assetlinks.json is the Sales Toolkit one
(package app.netlify.xtremesalestoolkit.twa) and is unchanged.

WHAT'S NEW IN 1.25
- Document numbers are still filled in automatically, but you can now type over them.
  If you type a higher number (e.g. XFM/QT/2026-3899) and submit, every phone carries
  on from there (the next one is 3900).
- New "+ Heading with sub-items" item in quotations, invoices and contracts: one heading
  (e.g. Office cleaning), any number of sub-items with their number of units
  (Office rooms 5, Meeting rooms 2, Pantry 1...) and ONE price for the whole block.
  The quotation PDF shows it like the Glass Partition Cleaning sample: heading row,
  numbered areas with units, and one price cell (excl. VAT). Converting the quotation
  to an invoice keeps the heading and sub-items.
- The signature block stays on page 1 when there is room above the footer.

WHAT'S NEW IN 1.24
- Automatic document numbers. Quotation ref, invoice no., contract no., receipt no.
  and COC no. are filled in for you and can't be typed over. All phones share one
  sequence on the server, so an Android phone and an iPhone never get the same number:
    Quotations  XFM/QT/2026-146     Tax invoices  XFM-INV-0081
    Contracts   XFM/CT/2026-1       Receipts      XFM-RCT-0001
    COC         XFM/COC/2026-1
  Numbers with a year start again at 1 every January. The first time, the app carries
  on from the highest number already saved. If another phone uses a number while you
  are filling a form, the preview takes the next free one and tells you.
  Admin: Settings > Document numbers sets the next number (e.g. to continue an old book).
- Settings follow you to every device. Zoho WorkDrive, Zoho Mail, users and numbering
  were already stored on the server; the app now re-reads them whenever it is opened or
  brought back to the front (and every 2 minutes), so a change made by the admin on an
  Android phone shows on iPhones without signing out. Your name and position for the
  PDF signature are now saved to your account too.
- If the phone has no connection for a moment when the app opens, it retries instead of
  dropping into on-device mode.

WHAT'S NEW IN 1.23
- Invoice: new "Add 5% VAT" switch on the Items step (on by default), like the
  quotation and contract already have. With VAT off the PDF is titled INVOICE
  (not TAX INVOICE) and shows no VAT line; email subject and file name follow.
- Loading a quotation into an invoice keeps the quotation's VAT choice.

WHAT'S NEW IN 1.22
- COC: one certificate can now cover several apartments. On the Property step,
  tap "+ Add apartment" for each unit (building is copied from the one above).
  With more than one apartment the PDF lists them in a table; certificates saved
  before this update still open with their apartment filled in.

WHAT'S NEW IN 1.21 (production check)
- PDFs: table rows now grow to fit long names, emails, addresses, project names,
  coverage and amount-in-words text, so nothing overlaps or runs outside its box
  (quotation, invoice, contract, receipt and COC).
- A single-service quotation with a very long scope now continues on the next
  page instead of running into the footer.
- Invoice items use the whole page before moving on; the words/total box sizes itself.
- Receipt reference row spans the full width; spacing under section bars fixed;
  stamp no longer covers the signature caption on quotations.
- WorkDrive: if a saved folder is deleted or moved, uploads find or recreate it
  instead of failing every time.
- Home tiles line up.

WHAT'S NEW IN 1.20
- Loading screen, then sign-in, then a home screen with a tile for every section
  the user is allowed to open. Tapping a tile opens it and the bottom bar appears.
- Every document is step-by-step: fill one part, tap Next. The last step is a
  full preview of the PDF. Submit then:
    1. ALWAYS saves the PDF to Zoho WorkDrive (users can't switch this off), and
    2. emails it to the customer if "Email a copy" is on. You can add several
       email addresses. The sending address is chosen per document type and
       can be changed before sending (e.g. quotations from sales@, invoices from accounts@).
  If you edit and send the same document again, the email subject starts with "Updated:".
- Users and access (admin only): up to 10 accounts, choose which sections each
  user can open, block/unblock, delete. Normal users never see Zoho or email
  settings and can't disconnect anything. The server enforces this too.

PHONE APPS (ANDROID APK AND IPHONE)
 The folder "mobile" holds the Android and iPhone app. Both open this Netlify site, so
 every phone uses the same accounts, numbers, Zoho and email settings, and website
 updates show in the apps straight away without a new build.
 Build: GitHub > Actions > "Mobile apps" > Run workflow (about 10 minutes).
 Download: on the repository page open Releases > "test-build".
   Android: open the .apk on the phone and allow installing.
   iPhone: needs an Apple Developer account. Add the 4 secrets listed at the top of
   .github/workflows/mobile.yml and every build goes to TestFlight automatically.
 If the site address is not https://xtremesalestoolkit.netlify.app, set it once under
 Settings > Secrets and variables > Actions > Variables > APP_URL.

UPDATE FROM YOUR PHONE (GitHub website, about 5 minutes)
 Tip: in Chrome, tap the 3 dots > tick "Desktop site" so GitHub shows every button.
 1. Open github.com > your repository xtreme-sales-toolkit.
 2. In the MAIN folder: Add file > Upload files > choose
       package.json   README.txt
    > Commit changes.
 3. Open the folder netlify > functions: Add file > Upload files > choose
       api.mjs
    > Commit changes.
 4. Open the folder public: Add file > Upload files > choose
       index.html   sw.js   manifest.webmanifest   assetlinks.json
    > Commit changes.
    (icon-192.png, icon-512.png, _headers, _redirects are already there. Leave them.)
 5. Netlify redeploys by itself in 1-2 minutes. Check:
       https://YOUR-SITE.netlify.app/api/ping      shows {"ok":true,"server":true}
       https://YOUR-SITE.netlify.app/.well-known/assetlinks.json   shows the JSON text
 6. Open the app. If you still see the old design, close it fully and open it again.

SET UP AUTOMATIC CUSTOMER EMAIL (admin, once)
 The app sends through your own Zoho Mail, so customers see your real addresses.
 A. Zoho Mail Admin Console > Users > (the sales mailbox) > Mail aliases:
    make sure every address you want to send from is an alias of that ONE mailbox,
    e.g. sales@xtreme-fm.com (the mailbox), accounts@xtreme-fm.com, noreply@xtreme-fm.com.
 B. Sign in to that mailbox > My Account (accounts.zoho.com) > Security >
    App passwords > Generate new password > name it "Xtreme app" > copy it.
    (If you don't see App passwords, turn on two-factor sign-in first.)
 C. Make sure SMTP access is allowed: Zoho Mail > Settings > Mail Accounts > IMAP/SMTP.
 D. In the app: Settings > Customer email (Zoho Mail)
       SMTP server: smtppro.zoho.com   (company domain accounts)
       Zoho Mail login: sales@xtreme-fm.com
       App password: paste it
       Send-from addresses: sales@xtreme-fm.com, accounts@xtreme-fm.com, noreply@xtreme-fm.com
    Tap Connect Zoho Mail. Then open "Which address sends each document", pick the
    default for each type (e.g. Quotations = sales@, Invoices = accounts@), Save,
    and use "Send a test to…" to check.

ZOHO WORKDRIVE
 Already connected from the Sales Toolkit. New folder: Completion Certificates.
 To reconnect: Settings > Zoho WorkDrive (steps as before: api-console.zoho.com >
 Self Client > scope WorkDrive.files.ALL > code; folder ID from the folder's web address).

NOTE ON OLD COC CERTIFICATES
 Certificates saved on the old COC site stay in its storage and in WorkDrive.
 "Open a saved certificate" in v1.20 lists certificates made in this app from now on.
