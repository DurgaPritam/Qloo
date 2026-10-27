# Go-to-market: how Takeover finds users and makes money

Takeover answers a question that people now answer with spreadsheets, gut feel and a few Instagram
follower counts: *who should we pair with, where, and who will come?* It answers it in about 20
seconds, from Qloo taste data, with every number traceable.

## Who pays, and for what

| Segment | Their job | The tool that hooks them | What they would pay for |
| --- | --- | --- | --- |
| Independent promoters and talent agents | Fill rooms; pitch co-headliners | Plan a takeover, Tour planner | More live plans, saved workspaces, branded PDF and deck exports |
| Venues, clubs and festivals | Book acts their city actually likes | Venue booker | A monthly "who to book" report for their city, alerts when a new act starts over-indexing |
| Brand and sponsorship teams, agencies | Choose talent and cities for activations | Brand match, Fan overlap | Team seats, more lookups, audience profiles in client decks, an API |
| Artists, comedians and their managers | Route tours; find collaborators | Tour planner, Fan overlap, City explorer | A free tier is enough for most; managers pay for the agency plan |
| Fans, creators, journalists | Curiosity, content | Fan overlap ("would these fans mix?") | Nothing. They are the growth loop. |

## Pricing (proposal)

- **Free**: everything on the site today, with the current limits (5 live plans and 30 lookups an
  hour). No sign-up. This is the growth engine.
- **Pro, per person**: unlimited plans and lookups, saved workspaces across devices, branded
  exports, plan history, priority model capacity.
- **Team / Agency**: seats, shared workspaces, client-ready decks with the agency's logo, the
  audience profile in every export, CSV export of every list.
- **API / data**: Fan overlap, Venue booker and Brand match as endpoints for ticketing platforms,
  booking tools and agency dashboards.

Prices should be set after talking to ten promoters and five brand teams; there is no data here
yet to set them responsibly.

## How users find it

1. **Fan overlap as the viral loop.** "Phoebe Bridgers × PEN15: strong overlap, Seattle" is a
   shareable fact. Every shared plan link already shows a preview card; the next step is a share
   card for overlap results and a one-click "post this" button.
2. **Search pages that rank.** Each overlap pair, city ("who to book in Austin") and fanbase
   ("Taylor Swift's strongest cities") can be a public page with its own title and preview card.
   People search for exactly these questions.
3. **Communities where bookers live.** Promoter and venue groups, comedy-booking forums,
   music-industry newsletters: post one real plan per week ("this week's takeover"), not ads.
4. **Partnerships.** Venues and small festivals get a free monthly city report with Takeover's
   name on it; booking platforms and ticketing tools embed Fan overlap as a widget.
5. **Content from the data.** Monthly "surprising pairings" and "cities that over-index" posts,
   drawn from real runs (Seattle beats New York for Phoebe Bridgers × PEN15). Journalists cite
   numbers that come with a source.

## What makes people come back

- **Saved plans across devices** (needs accounts) and a **weekly digest**: "3 new acts are
  over-indexing in your city".
- **Alerts** when a fanbase's strongest cities change, for tour planners.
- **Workspaces**: a promoter keeps every plan for one artist together, with notes.
- **Exports that go straight into the pitch**: the deck and PDF already exist; branded versions
  and the audience profile make them client-ready.

## What has to be true before charging

| Need | Why | Status |
| --- | --- | --- |
| A commercial Qloo agreement | The hackathon key is for the hackathon; paid use needs Qloo's terms and pricing | To ask Qloo |
| A paid model tier | The free Gemini tier allows ~20 requests a day per model and uses prompts to improve Google's products | Switch with a key; the code already supports it |
| Accounts and billing | Saved workspaces, Pro and Team plans | Needs an auth provider and a payment provider (user decision) |
| Privacy policy and terms | Accounts, exports, an API | To write |
| Measured usage | Which tool brings people back | Add privacy-friendly analytics |

## Metrics to watch

- Share rate of plan and overlap links, and visits that arrive from them.
- Plans per visitor; share of visitors who use a second tool.
- Return visitors within 7 days (the "would they come back" test).
- For paid plans later: conversion from the free limit message, and seats per team.

## The one-line pitch

**Takeover tells you who to pair with, where, and who will come, for any fanbase, in 20 seconds,
with every number from Qloo taste data.**
