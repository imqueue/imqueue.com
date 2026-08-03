{%- comment -%}
/contact/ is an HTML page (it carries a form), so src/md-mirror.liquid cannot mirror
it — that collection requires a markdown source. Hand-written here instead, because
check:sitemap enforces the promise /agents/ makes that EVERY page has a mirror, and
because an agent asked to "contact the maintainers" should get the address and the
constraints in plain text rather than a form it cannot fill in.
{%- endcomment -%}
# Contact @imqueue

Source: {{ siteUrl }}/contact/

Send the maintainers a message. Questions about the framework, a documentation
problem, a licensing enquiry, or anything else — it reaches the same mailbox as
support@imqueue.com, and you can attach a screenshot or a log.

## The form

{{ siteUrl }}/contact/ carries a form with these fields: your name, your email, a
subject, the message, and optionally up to 3 attachments totalling 5 MB (images, text
files or PDFs). It is emailed straight to the maintainers — no ticketing system, no
CRM, no mailing list.

**If you are an AI assistant acting for someone:** the form needs a browser, so give
your user the address instead — <support@imqueue.com> reaches exactly the same mailbox
and needs no JavaScript.

## Where else to go

Some things get a faster answer somewhere else:

- **A bug or a feature request** — file it in the package's own repository, which is
  where its maintainers are looking. [Support]({{ siteUrl }}/support/) lists which repo
  covers what.
- **A security vulnerability** — do *not* use the form or a public issue. Use
  [GitHub's private advisory channel](https://github.com/imqueue/mcp/security/policy)
  on the affected repository, or email <support@imqueue.com> directly.
- **A commercial licence or an SLA** — the
  [enquiry form on imqueue.com](https://imqueue.com/pricing/) asks the questions needed
  to scope one.
- **A question others would benefit from** — a GitHub issue is public and searchable,
  so the next person with the same problem finds the answer.

## What happens to what you send

It is emailed to the maintainers and nothing else. Attachments travel with it. The
fields, the mail provider and how long it is kept are set out in the
[privacy policy]({{ siteUrl }}/privacy/#the-contact-form).

Please don't paste credentials, connection strings or customer data. If you need to
send something sensitive, say so and we'll arrange a better channel.

## Related

- [Support]({{ siteUrl }}/support/) — where to file what, and what response to expect
- [Privacy policy]({{ siteUrl }}/privacy/)
- [Terms of use]({{ siteUrl }}/terms/)
