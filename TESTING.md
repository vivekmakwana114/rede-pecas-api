# Manual test guide — WhatsApp flow

Covers every case built/changed this round: registration, vehicle ID (VIN/photo/manual,
dedup, retry buttons), product search, service upsell, the stock-confirmation gate,
waitlist/restock, payment, and the admin/alert actions those last two require.

Run `npm run db:seed` before testing — it's now safe to re-run any time; it resets
every seed product back to its canonical quantity/price instead of leaving behind
whatever a previous test run mutated it to.

## Setup

```bash
npm run dev
```

**Important WhatsApp caveat**: this project's WhatsApp Business number is in Meta's
test/sandbox mode — it can only **send** messages to phone numbers explicitly added
to the app's allowed-recipient list in the Meta developer console. If your testing
number isn't on that list, every outbound send will fail with error 131030
("Recipient phone number not in allowed list"), even though your inbound messages
still reach the webhook fine. Add your test number there first.

### Get an admin access token (needed for every "admin action" step below)

```bash
curl -s -X POST http://localhost:4000/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@redepecas.ao","password":"admin123"}'
```

Copy the `accessToken` from the response and export it:

```bash
export TOKEN="paste-the-accessToken-here"
```

Every `curl` below assumes `$TOKEN` is set and uses `-H "Authorization: Bearer $TOKEN"`.

## Seed product reference

| Reference    | Name                                  | Qty | Service?                        | Search term to use   |
|--------------|----------------------------------------|-----|----------------------------------|-----------------------|
| W712/75      | Mann Oil Filter W712/75                | 8   | —                                 | "filtro de óleo"     |
| P7153        | Bosch Oil Filter P7153                 | 12  | —                                 | "filtro de óleo"     |
| OC611        | Mahle Oil Filter OC611                 | 5   | —                                 | "filtro de óleo"     |
| 06J115403Q   | Original VW Oil Filter                 | 2   | —                                 | "filtro de óleo"     |
| KYB334816    | Hilux Front Shock Absorber             | 4   | —                                 | "amortecedor" (only match — no alternatives) |
| TEX2369201   | Golf Front Brake Pads                  | 10  | —                                 | "pastilhas de travão"|
| W712/75-KIT  | Mann Oil Filter W712/75 Kit            | 6   | Instalação e troca de óleo (4500)| "filtro de óleo" (service test) |
| CT1028       | Correia Dentada Continental CT1028     | 0   | Instalação da correia (6000)     | "correia dentada" (waitlist+service) |
| CA1234       | Filtro de Ar Fram CA1234               | 0   | —                                 | "filtro de ar" (plain waitlist) |

## Test matrix

### Stage 01 — Registration

| # | Do this in WhatsApp | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 1 | Message the bot from a brand-new number: "Hi" | Welcome message, asks for name | No |
| 2 | Reply with your name | Asks about NIF (Sim/Não buttons) | No |
| 3 | Tap "Não" | Asks for delivery address | No |
| 4 | Reply with an address, or type "saltar" | Vehicle-ID choice buttons (VIN / photo / manual) | No |

### Stage 02 — Vehicle ID

| # | Do this | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 5 | Tap "🔢 Tenho o VIN", send a real 17-char VIN (e.g. `1HGCM82633A004352`) | "Identifying..." then a decode result with Sim/Não buttons | No |
| 6 | Send a 17-char VIN that isn't a real vehicle (e.g. `AAAAAAAAAAAAAAAAA`) | Decode-failed message, falls into manual entry (asks make) | No |
| 7 | **Dedup**: after confirming a vehicle, tap "Add vehicle" → VIN → send the **same VIN again** | "This vehicle is already in your profile" with "Search for a part" / "Add different vehicle" buttons | No |
| 8 | Tap "📄 Enviar foto", send a clear vehicle document photo | Extracted data shown with Sim/Não buttons | No — this is the one Claude Vision call (`extractDataWithClaudeVision`) |
| 9 | Send a blurry/unrelated photo instead | Failure message with "🔄 Try again" / "✍️ Manual" buttons | No |
| 10 | Tap "✍️ Manual" from #9, or "✍️ Manual" from the original 3-button choice | Walks make → model → year → engine number | No |
| 11 | With a vehicle already confirmed, tap "➕ Outro carro" (or type "outro carro") | Same VIN/photo/manual choice again for the new vehicle | No |

### Stage 04 — Stock search

| # | Do this | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 12 | Type "filtro de óleo" | List Message with up to 3 cheapest matches (ref, price, stock count, delivery, supplier in each row) | No |
| 13 | Type a part name that matches nothing at all (no product row exists), e.g. "peça inexistente xyz" | Plain "couldn't find it" text, no buttons (nothing to waitlist against) | No |
| 14 | Type "correia dentada" or "filtro de ar" (both seeded at qty 0) | "Couldn't find it" **with** "✅ Sim, avisa-me" / "❌ Não, obrigado" buttons | No |
| 15 | Tap "Sim, avisa-me" from #14 | "I'll notify you" confirmation | No — persists to `waitlist_requests` |

### Waitlist → restock (admin action required)

| # | Do this | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 16 | After #15, **restock the product as admin** (see below) | Nothing yet to the customer directly from this call | **Yes — admin restocks inventory** |
| 17 | Wait a few seconds | Customer automatically receives the rich restock message (name, product, vehicle, price, supplier) with "✅ Order now" / "❌ Not right now" buttons | (fires automatically once #16 runs) |
| 18 | Tap "Order now" | Creates the order, then proceeds exactly like picking it from search (service offer if applicable, then stock confirmation) | No further customer action; **admin still needs to confirm stock later — see Stage 05** |

Admin restock command (bumps `CT1028` from 0 → 5; use `CA1234` for the no-service variant):

```bash
curl -s -X POST http://localhost:4000/v1/admin/inventory/upload \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "reference": "CT1028", "name": "Correia Dentada Continental CT1028", "price": 9800, "quantity": 5, "supplierName": "Angola Moto Parts" }
    ]
  }'
```

### Product selection & service upsell

| # | Do this | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 19 | From the #12 list, tap/type the option for **W712/75-KIT** (has a service) | Short "you picked X" message, then "this product has a service" Sim/Não buttons | No |
| 20 | Tap "Sim" | "Service added, new total: X" then moves into stock confirmation (below) | **Yes — see Stage 05** |
| 21 | Tap "Não" | "No problem" then moves into stock confirmation | **Yes — see Stage 05** |
| 22 | Pick a plain option (e.g. W712/75, no service) | Skips the service question, straight into stock confirmation | **Yes — see Stage 05** |

### Stage 05 — Stock confirmation (admin action required — every single order needs this)

This is the big one: **no proforma or payment prompt ever goes out until the admin
explicitly confirms stock**, via the API (there's no admin UI in this repo).

| # | Do this | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 23 | (continuing from any order above) | Customer gets "confirming availability with the supplier..." | **Yes — admin must act next** |
| 24 | **As admin**, list pending orders | See the order in the `stockConfirmation` bucket with `waiting_minutes` | Admin |
| 25 | **As admin**, confirm stock | Customer receives "stock confirmed!" + the proforma PDF + payment-method buttons | Admin (this is the "confirm with the supplier" step — see note below) |
| 26 | Instead of #25, **mark stock unavailable** | Customer gets "no longer available, no payment taken" with "find alternatives" / "waitlist" buttons | Admin |
| 27 | Tap "find alternatives" after #26 | Fresh search excluding the declined product | No |
| 28 | Tap "find alternatives" when there are none left (use KYB334816, the only shock-absorber match) | Falls back to the waitlist buttons | No |
| 29 | Leave an order unconfirmed for 20+ minutes | Customer automatically gets the "sorry for the wait" courtesy message (checked every 60s) | No (automatic; see note on speeding this up below) |

```bash
# 24 — list orders, includes data.stockConfirmation[]
curl -s http://localhost:4000/v1/admin/orders -H "Authorization: Bearer $TOKEN"

# 25 — confirm stock for order RP-2026-00001 (use the real order number from #24)
curl -s -X POST http://localhost:4000/v1/admin/orders/RP-2026-00001/confirm-stock \
  -H "Authorization: Bearer $TOKEN"

# 26 — mark stock unavailable instead
curl -s -X POST http://localhost:4000/v1/admin/orders/RP-2026-00001/stock-unavailable \
  -H "Authorization: Bearer $TOKEN"
```

To test #29 without waiting 20 real minutes, backdate the order first:

```sql
UPDATE orders SET created_at = NOW() - INTERVAL '25 minutes' WHERE number = 'RP-2026-00001';
```

### Payment

| # | Do this | Expect | Admin/supplier action needed? |
|---|---|---|---|
| 30 | After stock is confirmed, tap "Transfer / Deposit" | Asks Bank Transfer vs Bank Deposit | No |
| 31 | Tap "Bank Transfer" | Instructions with IBAN + order number as reference | No |
| 32 | Send a photo as payment proof | Claude Vision validates it; if it looks like a real receipt, "proof received" message to customer | No — this is the second (and last) Claude call, `extractPaymentProofData` |
| 33 | Send an image that clearly isn't a receipt | "Couldn't confirm this is a valid proof, please resend" | No |
| 34 | Tap "Mobile POS (TPA)" instead of a bank method | Skips the proof-upload step entirely (in-person payment) | **Yes — admin alert created, no customer proof message** (matches the doc's note) |

### Admin alerts (replace the old WhatsApp-to-admin pushes)

Every payment-proof-received and in-person-payment-requested event now lands here
instead of the admin's WhatsApp — this is what you check after #32/#34 above.

```bash
# List alerts
curl -s http://localhost:4000/v1/admin/alerts -H "Authorization: Bearer $TOKEN"

# Mark one read (use the real id from the list above)
curl -s -X POST http://localhost:4000/v1/admin/alerts/1/read -H "Authorization: Bearer $TOKEN"
```

### Approving/rejecting the order (final admin step)

```bash
# Approve — sends the customer the final invoice PDF and notifies the supplier
curl -s -X POST http://localhost:4000/v1/admin/orders/RP-2026-00001/approve \
  -H "Authorization: Bearer $TOKEN"

# Reject — tells the customer their payment couldn't be confirmed
curl -s -X POST http://localhost:4000/v1/admin/orders/RP-2026-00001/reject \
  -H "Authorization: Bearer $TOKEN"
```

## Where "admin confirmation" and "supplier confirmation" actually happen

This is worth being precise about, since the doc's wording ("confirm with the supplier")
can read as if the system talks to the supplier directly — **it doesn't**:

- **Admin confirmation** happens at two points, both via the API above since there's
  no admin UI in this repo yet: (1) Stage 05's stock-confirmation gate
  (`confirm-stock` / `stock-unavailable`), and (2) approving/rejecting a paid order
  (`approve` / `reject`).
- **Supplier confirmation is not a system flow.** The doc's Stage 05 step 2 ("please
  confirm with the supplier that this item is physically available") is an
  instruction *to the admin* — the admin calls or messages the supplier themselves,
  outside this system, then clicks Confirm/Unavailable. There is no supplier-facing
  endpoint or webhook anywhere in this codebase.
- **Suppliers only ever receive one-way notices**, never asked to confirm anything
  back: the "prepare this item for pickup" WhatsApp message that fires automatically
  when an admin approves an order (`notifySupplierDelivery` in `payment.service.ts`).

If you want suppliers to actively confirm availability *in the system* (rather than
the admin handling it out of band by phone/WhatsApp), that's a new feature — this
session's work matches the doc as written, where the admin is the sole confirming
party for both steps.
