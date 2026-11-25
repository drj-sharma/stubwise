# CrewStub website

A static site: a home page, a privacy policy and a support page. No build step, no scripts and no third-party requests.

## Before it goes live

1. **App Store link.** The buttons on the home page point at the placeholder `APP_STORE_LINK`. When the app is in the App Store, replace it everywhere:

   ```bash
   sed -i '' 's#APP_STORE_LINK#https://apps.apple.com/app/crewstub/idYOURID#g' apps/web/index.html
   ```

   Do not publish the site before then: the buttons say "Available on the App Store" and would lead nowhere.
2. **Fill in the highlighted placeholders** in `privacy.html` (search for `class="todo"`): the date the policy takes effect, who runs CrewStub and their address, and how many days server logs and backups are kept.
3. Support and privacy questions go to `crewstub.support@gmail.com`.

The privacy policy describes how the app works today. It is not legal advice: read it against what the app and server really do, and have it checked if you can.

The App Store asks for a privacy policy URL and a support URL: use `https://<your-site>/privacy.html` and `https://<your-site>/support.html`.

The screenshots in `img/` were taken from the app in the iOS simulator with made-up demo data (a fictional business and three fictional workers). Retake them when the app's screens change.

## Preview

```bash
python3 -m http.server 8090 --directory apps/web
```

Then open http://127.0.0.1:8090.

## Deploy to Cloudflare Pages

Use the Cloudflare account you want to own the site. Wrangler keeps its login in the home folder, so to keep this project apart from any other Cloudflare account on this Mac, point `HOME` at the project's own folder:

```bash
cd apps/web
HOME=../../.local/home npx wrangler whoami
HOME=../../.local/home npx wrangler login
HOME=../../.local/home npx wrangler pages deploy . --project-name crewstub
```

`wrangler whoami` shows which account is signed in; run `wrangler login` only if it is the wrong one or none. The first deploy asks to create the project. The site then lives at `https://crewstub.pages.dev` (or the name you chose). Add your own domain under the project's Custom domains in the Cloudflare dashboard.

`_headers` sets security headers and caching for Cloudflare Pages.
