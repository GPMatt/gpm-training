# RingCentral turn-text test (P03)

Test only: texts go to Matt's phone, nothing reaches vendors.

## 1. Make the app (Developer Console)
Use a fresh app, not the hello-world sample, so it has texting permission:
- REST API App, **JWT auth flow**, **private** ("only callable using credentials from the same account")
- Permissions: **SMS**, **ReadAccounts**, **ReadMessages** (ReadMessages is for reading replies)
- JWT: hover your name (top right) > Credentials > Create JWT. Limit it to this app's Client ID.

## 2. Save the secrets locally
1. In Finder press Cmd+Shift+. to show hidden files, open this folder, open `.env` in TextEdit.
2. Paste each value after the `=` (no quotes, no spaces). Save.
3. `.env` is git-ignored and readable only by you (chmod 600). `.env.example` is the blank template.
Never paste these into email, chat, or the code.

## 3. Put the same values in Apps Script
1. script.google.com > New project, name it "RC Turn Text Test".
2. Paste `Code.js` into `Code.gs`.
3. Project Settings (gear) > Script Properties > add each line from `.env` as a property
   (same name, same value): RC_SERVER, RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT, RC_FROM_NUMBER, TEST_TO_NUMBER.

## 4. Run (in `Code.gs`)
1. `listMyNumbers`: approve permissions; the log shows each number and "CAN TEXT" or not.
2. `sendTestText`: one text to your phone.
3. Reply from your phone ("1", "DONE" + photo, then "STOP" and "START"), then run `checkReplies`.
4. `installPollTrigger`: checks every 5 minutes. `removePollTrigger` turns it off.

If a run fails, copy the log error (it never prints your secrets).
