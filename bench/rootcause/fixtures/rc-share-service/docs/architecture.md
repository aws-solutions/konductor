# FileDrop: architecture

FileDrop lets signed-in users upload files and share them with other people through a link.

## Components

1. Web app: a single-page app that runs in the user's browser.
2. API service: the only backend the web app calls. It also serves the admin endpoints.
3. Identity provider: an external single sign-on service (OpenID Connect). The API exchanges the sign-in result for a session cookie.
4. Object store: holds the uploaded files.
5. Metadata database: holds user records, file records (name, owner, size), share links and link passwords.
6. Scan worker: takes a message from a queue for each upload and scans the file for malware.
7. Mailer: sends notification email through an SMTP relay.
8. Admin console: pages of the web app under `/admin` for support staff.

## Flows

1. Sign in. The user signs in at the identity provider. The API sets a session cookie that lasts 30 days.
2. Upload. The API returns a pre-signed upload URL and the browser sends the file straight to the object store. There is no size limit. The API writes the file record and puts a message on the scan queue. The file can be downloaded as soon as it is uploaded. The scan worker deletes a file it finds infected, usually within a few minutes.
3. Share. The uploader creates a share link of the form `https://files.example.test/s/<token>`. The token is 6 characters from a to z and 0 to 9. The uploader may set an expiry (default: never) and may set a password of at least 4 characters. Passwords are stored as unsalted SHA-1 hashes.
4. Download. The recipient opens the link. The API checks the token, the expiry and the password, then redirects to a pre-signed download URL that is valid for 24 hours. The number of password attempts is not limited.
5. Notify. When a link is created the mailer sends the recipients an email with the uploader's name, the file name and the link. The relay uses TLS when the receiving server supports it.
6. Administer. Support staff open the admin console to look up files and delete them. The admin menu is shown only to users with the admin role. The `/api/admin/*` endpoints require a valid session.
7. Logging. The API writes error logs. Successful downloads and admin actions are not logged.
