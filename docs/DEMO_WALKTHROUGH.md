# RepCount: Live Gym Owner Demonstration (Empty Start)

**Presented by Alif Growth Media.** The public showcase is an isolated browser-only demonstration. It now starts with **no membership plans, members, payments, dues, renewals or fake staff**. The only existing identity is the demo Admin.

## Preparation
1. Open the RepCount customer demo: https://e-repcount-gym-payment-manager-three.vercel.app/login
2. Sign in with the **public demo-only** email `admin@gmail.com` and password `admin@123`, or press **Fill demo credentials**.
3. If you previously used the showcase, open Settings and press **Clear demo workspace**, confirm, then return to the dashboard. Old preloaded demo records from earlier releases are automatically ignored.
4. For demonstrations, use **fictional member names and phone numbers** or synthetic examples. Do not enter real, identifiable gym customer data into a browser-local demo. Actual gym records must be collected only in the client's private Supabase-backed deployment with `VITE_REPCOUNT_DEMO_MODE=false`.

## Show the pain point first
Ask the gym owner: **"Which members' subscriptions expire next week? How do you find their number and remember to contact them?"** Then demonstrate how the app stores the member and next renewal date.

## On-screen steps — approximately 8 minutes

1. **Start from zero.** On Overview, show the zero-member and zero-renewal counters. Explain that the gym has no records yet.
2. **Create the gym's first plan.** Click **Create first plan**, enter (for example) `Monthly Gym Access`, duration `1 month`, fee `₹1,200`; save it.
3. **Enroll a member with an upfront fee.** Navigate to **Members → Add member**, enter fictitious contact details, select the plan and keep **Membership fee received today** checked. Select payment method `UPI`. Save.
4. **Verify automatic next billing date.** Show the member's record and next renewal date (one calendar month after the payment date); open **Payments** to show the recorded upfront payment.
5. **Show what happens later.** Go to **Renewals**, find the member and show the **WhatsApp reminder** action. It opens a prepared message; a real person must review/send it. No automated message has been delivered.
6. **Demonstrate renewals.** Click **Record renewal**, select the existing plan and payment method, confirm the next fee. When the member renews early, RepCount adds the new plan period to their existing renewal date rather than cutting off days they already paid for.
7. **Show the dashboard.** Return to Overview. Explain that a gym with hundreds of members sees active, upcoming, and expired memberships without relying on a paper register.
8. **Start fresh for the next owner.** Settings → **Clear demo workspace** → confirm. All demonstration entries in the current browser return to zero; this does **not** delete real Supabase data.

## Important limitations

- The public showcase uses a fixed password and browser-local storage, **not a secure real gym database**. Records created there do not synchronize to Supabase or to another device/browser.
- Public demo data can be erased on reset, clearing browser storage or moving to another device. The feature is for sales demonstrations only.
- Actual gym installations require an independently created Supabase project, a verified first Admin and a fresh Vercel deployment using `VITE_REPCOUNT_DEMO_MODE=false`.
- WhatsApp reminders are manual, not sent automatically. Do not promise automated bulk reminders or payment gateway collection.
- To give a customer a working production system after the demonstration, follow [the gym setup guide](GYM_SETUP.md) and complete the acceptance checks.
