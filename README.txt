XTREME v1.20 - ONE APP FOR QUOTES, INVOICES, CONTRACTS, RECEIPTS AND COC
=======================================================================

This replaces the Xtreme Sales Toolkit on the SAME Netlify site and the SAME
GitHub repository (xtreme-sales-toolkit). The COC site can be retired afterwards.
Your existing users, Zoho WorkDrive connection and saved quotations/invoices carry over.
The Android app keeps working: assetlinks.json is the Sales Toolkit one
(package app.netlify.xtremesalestoolkit.twa) and is unchanged.

WHAT'S NEW
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
