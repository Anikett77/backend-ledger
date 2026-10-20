Authorization: Bearer <token>

POST /api/auth/register
{ "email": "a@test.com", "password": "password123", "name": "User A" }
Save token and later the account _id.

Repeat for User B.

POST /api/accounts/ (User A token) → save account._id as fromAccount
POST /api/accounts/ (User B token) → save as toAccount

Credit User A from the system user (needs systemUser: true in Mongo; register does not create that):
POST /api/transactions/system/initial-funds
{ "toAccount": "<A account id>", "amount": 1000, "idempotencyKey": "init-1" }

Transfer:
POST /api/transactions/ with User A token
{ "fromAccount": "<A>", "toAccount": "<B>", "amount": 250, "idempotencyKey": "xfer-1" }

Check:
GET /api/accounts/balance/<A id> → 750
GET /api/accounts/balance/<B id> → 250