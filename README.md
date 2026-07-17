# Intercommunication Messaging Queue For Microservices

Please, visit at [imqueue.com](https://imqueue.com/)

This site is a static site built with [Eleventy](https://www.11ty.dev/).

## Local development

~~~
cd imqueue.com
npm install
npm run serve   # dev server with live reload at http://localhost:8080
~~~

## Production build

~~~
npm run build   # outputs static site to ./_site
~~~

Deployment is automated: pushing to `master` triggers the
`.github/workflows/deploy.yml` GitHub Actions workflow, which builds the site
and publishes `_site/` to GitHub Pages.
