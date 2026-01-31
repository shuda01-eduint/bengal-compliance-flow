

# Fix: "Email not confirmed" Login Error After Re-registration

## Summary of the Problem

You re-registered with **adnan@ucbstock.com.bd** and the new Auth user was created with ID `32e41b94-c9b1-47c0-84e7-19bfa5232228`. However:

1. **Email confirmation is required** - The backend enforces email verification before login
2. **No confirmation email received** - You need to click the link in the confirmation email that was sent to adnan@ucbstock.com.bd
3. **Profile not created for new user** - The new Auth user (`32e41b94...`) does NOT have a corresponding profile in the `profiles` table. The old profile (`f0ddc7dd...`) still exists from the previous Supabase project but is linked to a different Auth user ID

## Why This Happened

When you migrated to the new Supabase project:
- Your **profiles** and **user_roles** tables were migrated (data transfer)
- The **auth.users** table was NOT migrated (this is internal to each Supabase project and cannot be exported)
- So the old profile ID (`f0ddc7dd...`) doesn't match any Auth user in the new backend
- When you re-registered, a NEW Auth user (`32e41b94...`) was created, but the `handle_new_user` trigger created a NEW profile for it (with `is_approved = false`)

Wait - actually the new profile wasn't created either. Let me check why... The trigger exists and is enabled, so the profile insert may have silently failed due to a constraint or the user's email domain not being confirmed yet.

## Solution: Two Steps

### Step 1: Confirm Your Email First (Immediate Action)

Check your inbox (and spam folder) for **adnan@ucbstock.com.bd** for the confirmation email from the new Supabase project. Click the confirmation link to verify your email address.

If you can't find the confirmation email, I'll add a "Resend Confirmation" button to the login page so you can request a new one.

### Step 2: Link New Auth User to Existing Profile (Database Fix)

After confirming your email, there's still a mismatch:
- New Auth user ID: `32e41b94-c9b1-47c0-84e7-19bfa5232228`
- Old profile ID: `f0ddc7dd-4f1b-4940-9ec0-93170afbd3bd`

We need to either:
- **Option A**: Update the old profile to use the new Auth user ID (keeps all admin roles/approval intact)
- **Option B**: Create a new profile for the new Auth user and manually set is_approved=true and assign admin role

**Recommended: Option A** - preserves your existing admin setup.

---

## Implementation Plan

### Part 1: Add "Resend Confirmation Email" to Login Page

**File: `src/pages/AuthPage.tsx`**

Add a "Resend confirmation email" link that appears when a user gets the "Email not confirmed" error. This will call `supabase.auth.resend({ type: 'signup', email })`.

Changes:
- Add state to track if email confirmation is needed
- Add UI to allow resending confirmation email
- Handle the resend flow with proper feedback

### Part 2: Database Migration to Fix Profile ID Mismatch

After you confirm your email, run a migration to:

```sql
-- Update the existing approved admin profile to use the new Auth user ID
-- This ensures your admin access is preserved

-- Step 1: Delete any orphan profile that might have been created for the new user
DELETE FROM public.profiles WHERE id = '32e41b94-c9b1-47c0-84e7-19bfa5232228';
DELETE FROM public.user_roles WHERE user_id = '32e41b94-c9b1-47c0-84e7-19bfa5232228';

-- Step 2: Update the old profile to point to the new Auth user ID
UPDATE public.profiles 
SET id = '32e41b94-c9b1-47c0-84e7-19bfa5232228'
WHERE id = 'f0ddc7dd-4f1b-4940-9ec0-93170afbd3bd';

-- Step 3: Update user_roles to point to the new Auth user ID
UPDATE public.user_roles 
SET user_id = '32e41b94-c9b1-47c0-84e7-19bfa5232228'
WHERE user_id = 'f0ddc7dd-4f1b-4940-9ec0-93170afbd3bd';
```

---

## Files to Change

| File | Change |
|------|--------|
| `src/pages/AuthPage.tsx` | Add "Resend confirmation email" functionality |
| Database migration | Update profile/user_roles to link to new Auth user ID |

## Testing Checklist

1. Check spam folder for confirmation email from the new backend
2. Click confirmation link OR use new resend button
3. After confirmation, verify you can log in as admin
4. Verify admin panel access works correctly

