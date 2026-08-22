/* Team sync configuration.
 *
 * Leave SYNC_URL empty and the grid works on its own: everything saves in your
 * own browser, and every column is editable.
 *
 * Set it to the deployed Cloudflare Worker in worker/ and the whole team
 * shares one live grid. Each player opens a personal link once to claim their
 * column, and from then on can only change their own row -- no accounts, no
 * logins, and no marking somebody else's availability by accident.
 *
 * See "Turning on team sync" in the README. The URL looks like:
 *
 *   https://benders-availability.<your-subdomain>.workers.dev
 */

window.SYNC_URL = "https://benders-availability.bengrier.workers.dev";
