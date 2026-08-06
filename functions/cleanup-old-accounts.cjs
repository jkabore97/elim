/**
 * Deletes member accounts created before a cutoff date.
 *
 * Run it in Google Cloud Shell:
 *
 *     cd ~/elim/functions && npm install
 *     node cleanup-old-accounts.cjs            # DRY RUN - lists only
 *     node cleanup-old-accounts.cjs --confirm  # actually deletes
 *
 * It lives in functions/ rather than a scripts/ folder because Node resolves
 * packages by walking up from the SCRIPT's own directory, not from where you
 * happen to be standing. firebase-admin is installed in functions/node_modules,
 * so anywhere else the require() simply doesn't find it.
 *
 * The .cjs extension is deliberate too: the repo's root package.json sets
 * "type": "module", so a .js file would be treated as an ES module and the
 * CommonJS require() calls below would fail outright.
 *
 * It defaults to a DRY RUN and prints exactly what it would remove. Nothing is
 * touched until --confirm is passed, so you can check the list first.
 *
 * WHAT IT SPARES, always:
 *   - admin, pastor, church (leads), and pending_church
 *   - anyone created on or after the cutoff
 *   - anyone whose createdAt is missing (see note below)
 *
 * WHAT IT DELETES, for each matched account:
 *   - the Firestore users/{uid} document
 *   - the Firebase Auth login itself
 *
 * Both matter. Removing only the Firestore document would leave a login that
 * still works but has no profile behind it - the app would break for that
 * person rather than simply not knowing them.
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const CUTOFF = new Date('2026-08-04T00:00:00Z');
const SPARE_ROLES = ['admin', 'pastor', 'church', 'pending_church'];
const CONFIRM = process.argv.includes('--confirm');

initializeApp({ credential: applicationDefault() });

async function main() {
  const db = getFirestore();
  const auth = getAuth();

  const snap = await db.collection('users').get();
  const doomed = [];
  const spared = { byRole: 0, byDate: 0, noDate: 0 };

  snap.forEach((doc) => {
    const d = doc.data();

    if (SPARE_ROLES.includes(d.role)) { spared.byRole++; return; }

    // A missing createdAt is ambiguous, and the safe reading of ambiguity in a
    // destructive operation is "leave it alone". These are reported so they can
    // be reviewed by hand rather than silently swept up.
    if (!d.createdAt || !d.createdAt.toDate) { spared.noDate++; return; }

    if (d.createdAt.toDate() >= CUTOFF) { spared.byDate++; return; }

    doomed.push({
      uid: doc.id,
      name: d.displayName || '(no name)',
      role: d.role || '(no role)',
      phone: d.phone || d.email || '',
      created: d.createdAt.toDate().toISOString().split('T')[0]
    });
  });

  console.log(`\nCutoff: accounts created BEFORE ${CUTOFF.toISOString().split('T')[0]}`);
  console.log(`Total accounts scanned : ${snap.size}`);
  console.log(`Kept (admin/pastor/lead/pending) : ${spared.byRole}`);
  console.log(`Kept (created on or after cutoff): ${spared.byDate}`);
  console.log(`Kept (no creation date - review manually): ${spared.noDate}`);
  console.log(`\nMATCHED FOR DELETION: ${doomed.length}\n`);

  doomed.forEach((u, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${u.created}  ${u.role.padEnd(15)} ${u.name}  ${u.phone}`);
  });

  if (!CONFIRM) {
    console.log('\n--- DRY RUN. Nothing was deleted. ---');
    console.log('Review the list above. To delete for real, re-run with --confirm\n');
    return;
  }

  if (doomed.length === 0) {
    console.log('\nNothing to delete.\n');
    return;
  }

  console.log('\nDeleting...\n');
  let okAuth = 0, okDoc = 0, failed = 0, authInternalErrors = 0;

  for (const u of doomed) {
    // Auth first: if this fails we still have the Firestore document, so the
    // account remains findable and the failure can be chased. Deleting the
    // document first and then failing here would leave an invisible orphan.
    try {
      await auth.deleteUser(u.uid);
      okAuth++;
    } catch (err) {
      // auth/user-not-found just means the login was already gone.
      if (err.code !== 'auth/user-not-found') {
        console.log(`  ! auth delete failed for ${u.name}: ${err.code || err.message}`);
        if (err.code === 'auth/internal-error') authInternalErrors++;
        failed++;
        // Deliberately NOT falling through to delete the profile. Removing the
        // document while the login survives leaves someone able to sign in with
        // no profile behind them, which breaks the app for them rather than
        // simply forgetting them.
        continue;
      }
    }

    try {
      await db.collection('users').doc(u.uid).delete();
      okDoc++;
    } catch (err) {
      console.log(`  ! doc delete failed for ${u.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Auth logins removed: ${okAuth}. Profile documents removed: ${okDoc}. Failures: ${failed}\n`);

  if (authInternalErrors > 0) {
    console.log('-----------------------------------------------------------');
    console.log('Every deletion failed with auth/internal-error.');
    console.log('');
    console.log('This is a CREDENTIALS problem, not a data problem - nothing');
    console.log('was changed. Cloud Shell signs you in with your personal');
    console.log('Google account, which can read Firestore (the listing above');
    console.log('worked) but cannot delete Firebase Auth users. That requires');
    console.log('a service account key.');
    console.log('');
    console.log('To fix:');
    console.log('  1. Firebase console > Project settings (gear icon)');
    console.log('  2. "Service accounts" tab > Generate new private key');
    console.log('  3. Upload the downloaded .json into Cloud Shell');
    console.log('     (three-dot menu > Upload)');
    console.log('  4. Then run:');
    console.log('       export GOOGLE_APPLICATION_CREDENTIALS=~/<that-file>.json');
    console.log('       node cleanup-old-accounts.cjs --confirm');
    console.log('');
    console.log('Treat that key like a password: it grants full access to the');
    console.log('project. Delete it from Cloud Shell when you are done:');
    console.log('       rm ~/<that-file>.json');
    console.log('-----------------------------------------------------------\n');
    return;
  }
  console.log('Note: posts, comments, likes and messages made by these people are');
  console.log('NOT removed - deleting them would tear holes in threads other');
  console.log('people are still reading. Remove any specific ones by hand from');
  console.log('Admin > Donnees > Explorer if needed.\n');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
