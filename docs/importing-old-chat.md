# Bringing across the old campus chat

The previous campus chat kept its data in `comm_*` tables (usually in the same database as the student
records). One command brings it across. You can run it more than once: anything already brought across is
skipped, so a second run only picks up messages written since.

```
php artisan sos:import-campus-chat ABC --dry-run      # count first, change nothing
php artisan sos:import-campus-chat ABC --files-url=https://old-chat-server
```

`ABC` is your institution's short code. Without `--database` it reads the records database you connected in
Admin → Settings → Your records. If the old chat tables are somewhere else, add
`--host=… --database=… --username=…` and it asks for the password.

**Run "Sync from records" (Admin → Structure) first**, so faculties and departments exist and old faculty,
department and level groups can be matched.

| Old system | Here |
|---|---|
| People (`comm_chat_identities`) | Accounts for the same students and staff (same records ids), so they find their history when they sign in. Nobody gets a password or a role. |
| Private chats | Private chats between the same two people |
| Groups people made | Groups with the same name, members and admins |
| University, faculty, department and level groups | The matching standing groups here. Their members come from the records at sign-in. |
| Messages | Messages with the original time and sender, already marked as read |
| Photos, voice notes, files | A note ("Photo", "Voice note", "File: name") with a link to the original on the old server (give `--files-url`) |
| Announcements | Notices for everyone |

Status updates, reactions, polls and read receipts are not brought across.
