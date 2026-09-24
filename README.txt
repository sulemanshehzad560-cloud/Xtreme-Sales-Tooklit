XTREME SALES TOOLKIT v10 - SECURE VERSION WITH ZOHO WORKDRIVE
================================================================

WHAT'S NEW
- Convert documents by reference number:
  Invoice tab > "Convert a quotation": type the quotation number (e.g. 145) > Load.
  Receipt tab > "Load from a document": choose Quotation or Invoice, type the number > Load.
  Items, prices, discount and customer details fill in, and everything stays editable.
  A quotation or invoice is saved for converting when its PDF is made (email, share or
  Save to Zoho WorkDrive). The latest saved documents show as quick buttons.
- Sign-in page. Only 2 accounts, no sign-ups.
  First sign-in: username admin, password admin (all small letters).
  You are then asked to set your own username and a new password.
  5 wrong passwords lock that username for 15 minutes.
- Settings (gear icon, top right): change password, create/disable the 2nd user,
  connect Zoho WorkDrive, sign out.
- Every quotation, invoice, receipt and contract PDF you email or share is uploaded
  to Zoho WorkDrive automatically, into folders like:
     Your folder / Invoices / 2026-09 September / Tax Invoice XFM-INV-0080.pdf
  There is also a "Save to Zoho WorkDrive" button on each document.

IMPORTANT: THIS VERSION MUST BE DEPLOYED THROUGH GITHUB, NOT DRAG-AND-DROP
Netlify drag-and-drop cannot run the server part (login + Zoho). Setup once from a computer:

STEP 1 - Put the files on GitHub (5 min)
 1. Unzip this file. You get a folder "xtreme-sales-toolkit" containing:
    netlify.toml, package.json, README.txt, public/, netlify/
 2. Go to github.com, sign up / sign in, tap "+" > "New repository".
    Name: xtreme-sales-toolkit. Choose PRIVATE. Create.
 3. On the new repository page click "uploading an existing file".
 4. Open the unzipped folder, select EVERYTHING INSIDE it (the 2 folders and 3 files)
    and drag them into the GitHub page. Click "Commit changes".
    Check that GitHub shows: netlify, public, netlify.toml, package.json, README.txt

STEP 2 - Connect GitHub to your Netlify site (3 min)
 1. Netlify > your Sales Toolkit site > Site configuration > Build & deploy >
    "Link repository" (or "Link site to Git") > GitHub > choose xtreme-sales-toolkit.
 2. Netlify reads netlify.toml by itself. Leave the build command empty and click Deploy.
 3. Wait for the green "Published" label. Keep the same site so the address and the
    Android app (assetlinks.json is included in public/) keep working.
 From now on, to update the app: upload the changed files to GitHub. Netlify redeploys itself.

STEP 3 - Sign in
 Open the site. The badge must say "Secure server sign-in".
 (If it says "On-device sign-in", the server part isn't running - repeat Step 2.)
 Sign in with admin / admin and set your own username and password straight away.

STEP 4 - Connect Zoho WorkDrive (admin, 5 min)
 1. On a computer go to api-console.zoho.com (use the data centre you log in to,
    e.g. api-console.zoho.com, .eu, .in or .ae).
 2. Add Client > "Self Client" > Create. Copy the Client ID and Client Secret.
 3. In the Self Client, open "Generate Code":
      Scope:          WorkDrive.files.ALL
      Time duration:  10 minutes
      Description:    Xtreme Sales Toolkit
    Click Create and copy the code.
 4. In Zoho WorkDrive, create or open the folder where documents should go
    (e.g. "Xtreme Documents"). Its web address ends in a long ID - copy that ID.
 5. In the app: Settings > Zoho WorkDrive. Choose the data centre, paste Client ID,
    Client Secret, the code and the folder ID. Tap Connect within 10 minutes.
 6. The status turns green: "Connected". Done - uploads are automatic from now on.
    The top bar shows "Drive · Auto". Tap it to open Settings.

STEP 5 - Second user
 Settings > Users > type a username and password > Create user.
 They must change the password on their first sign-in.

ANDROID APP (ADDRESS BAR)
 assetlinks.json is in public/ (package app.netlify.xtremesalestoolkit.twa).
 Check https://YOUR-SITE.netlify.app/.well-known/assetlinks.json shows the JSON text,
 then uninstall and reinstall the APK.

SECURITY NOTES
 - Passwords are stored hashed (scrypt) on the Netlify server, never in the page.
 - The Zoho keys are stored only on the server; the phone never sees them.
 - Sessions last 12 hours (30 days if "Keep me signed in" is ticked).
   Changing a password signs that account out everywhere else.
