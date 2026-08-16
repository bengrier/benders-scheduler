/* Team sync configuration.
 *
 * Leave SYNC_URL empty and the grid works exactly as before: everything saves
 * in your own browser only.
 *
 * Set it to a Firebase Realtime Database URL and the whole team shares one
 * live grid -- each player marks their own row from their own phone and
 * everyone else sees it appear. Still no accounts and no logins.
 *
 * Setup takes about two minutes; see "Turning on team sync" in the README.
 * The URL looks like one of these:
 *
 *   https://benders-abc123-default-rtdb.firebaseio.com
 *   https://benders-abc123-default-rtdb.us-central1.firebasedatabase.app
 */

window.SYNC_URL = "";
