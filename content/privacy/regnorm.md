---
lastUpdated: 2026-11-15
placeholder: false
---

<!--
  Written from Regnorm's code on 12 November 2026 (C:\Apps\Regnorm). Reviewed and published
  12 November 2026; photos and garden sharing added 15 November 2026. Keep it in step with the app's Data safety answers in Play Console
  (Regnorm/PUBLISHING.md).
-->

{{appName}} is a plant care app for Android made by {{developerName}}. It reminds you to water your plants, using the weather where your garden is. This policy explains what happens to your information when you use the app.

## Your plants stay on your phone

Everything you add, including your plants, where they grow, when you watered them, their heights, pot sizes and photos, is stored only on your phone. There is no account to create. The one exception is if you choose to share your garden with other people (see below); otherwise your plants are never uploaded.

## Photos of your plants

With Plus, you can add a photo to a height measurement. You either take it with your phone's camera app or choose it in Android's photo picker, so {{appName}} never gets access to your camera or your other photos, only to the one photo you pick. The app makes a smaller copy, keeps it only on your phone, and never uploads it. Removing the measurement or the plant deletes the copy.

## Sharing a garden

You can share your garden with the people you live with, so you all see the same plants and who watered them. Sharing is optional and off until you start it or join with an invite code.

- **What is shared.** While you share, the garden's plants (name, type, where they grow, waterings, heights, pot sizes and fertilising), your own plant types, the garden's location (the rounded position and place name) and the name you type for yourself are stored on {{appName}}'s server so that the members' phones can sync. Each watering shows the name of the member who did it. **Photos are never shared or uploaded**; they stay on the phone that took them.
- **Where.** The server is Google Firebase (Cloud Firestore), in Google's data centres in the EU. Google processes the data on our behalf: <https://firebase.google.com/support/privacy>
- **No account.** Each phone gets a random ID from Firebase's anonymous sign-in. No email, phone number or password is involved, and the ID is not linked to your Google account or the advertising ID. Only the members of a garden can read it.
- **Invite codes.** An invite is a six-letter code that works for 7 days. Only someone with the code can join.
- **Leaving and deleting.** A member can leave at any time under **Settings → Share your garden**; their name is removed from the member list. When the person who started the garden taps **Stop sharing**, the garden, its plants, its own plant types and its invite codes are deleted from the server for everyone. Each phone keeps its own copy of the plants.

## Your garden's location and the weather

To estimate when garden plants need water, {{appName}} uses the weather where your garden is. Setting a location is optional; without one, the app only uses watering schedules.

- **Use my location.** If you tap this, the app asks Android for your approximate location (not your precise location), once. Android may use Google's location services to find it.
- **Typing a town or postcode.** The text you type is looked up with Android's built-in place search, which on most phones is provided by Google. The same search finds a place name for your approximate location.
- **What is kept.** The app keeps only a position rounded to about 1 km and the place name, on your phone.
- **The weather in Denmark.** For a garden in Denmark, the weather comes from the Danish Meteorological Institute's open data (DMI). To get it, the app sends the rounded position, and the 10 km weather square it lies in, to DMI's servers. Read about DMI's open data: <https://www.dmi.dk/friedata>
- **The weather elsewhere.** For a garden outside Denmark, the weather comes from the Norwegian Meteorological Institute's forecast (MET Norway). To get it, the app sends the rounded position to MET Norway's servers, with the app's name so they can see which app is asking. Read MET Norway's terms: <https://api.met.no/doc/TermsOfService>
- Like any website, these servers see your IP address. The app only asks while it is open, and at most every few hours.

## The plant list

The app comes with a list of plants and their care needs. While the app is open, it checks at most once a day for an updated list at srath.dk. This is a plain download of the same file for everyone; no information about you or your plants is sent. The website is hosted by GitHub Pages, whose servers see your IP address: <https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement>

## Reminders and the widget

The daily reminder and the home-screen widget are worked out on your phone from your plants and the last weather the app fetched. They do not go online, also in a shared garden.

## Ads

Without Plus, {{appName}} shows one banner ad above the tabs at the bottom of the screen, provided by Google AdMob. Ads are not shown on a plant's own page or in settings. The ad never sees your plants. To show and measure ads, Google and its advertising partners may collect:

- your device's advertising ID
- your approximate location, based on your IP address
- information about your device and how ads are viewed and clicked

In the EU/EEA, the UK and Switzerland, the app asks for your consent before personalised ads are shown. You can change your choice at any time under **Settings → Ad privacy choices** in the app. You can also reset or delete your advertising ID in your phone's settings. With Plus, no ads are shown: the banner disappears as soon as you buy it, and from the next time you open the app, AdMob is not started at all.

Read how Google uses data: <https://policies.google.com/technologies/partner-sites>

## {{appName}} Plus

Plus is a one-time purchase handled entirely by Google Play. We never see your payment details. When you buy Plus, and each time the app opens, the app asks Google Play whether your Google account owns Plus, so it can unlock the Plus features and turn off the ad. That is all the app learns about your purchase. Google handles the payment under its own privacy policy: <https://policies.google.com/privacy>

## Android backup

If Android backup is turned on, your phone may include your plants, their photos, your garden's saved location and your settings in your personal Google backup, so they come back on a new phone. These backups belong to your Google account, and we cannot access them.

## What we do not do

- We do not sell your data.
- We do not use analytics or tracking tools of our own.
- We do not ask you to create an account.
- We do not upload your plants unless you share your garden, and never your photos.

## Deleting your data

You can remove a plant, a measurement or a photo at any time from the plant's own page. Uninstalling the app, or clearing its storage in your phone's settings, deletes all plants, photos, the saved location and settings on the phone. A shared garden is deleted from the server when its owner stops sharing; you can also ask us to delete it by writing to the address below.

## Children

{{appName}} is not directed at children under 16.

## Changes

If this policy changes, the new version will be posted on this page with a new date before the change reaches the app.

- 15 November 2026: added photos of your plants (Plus) and sharing a garden.
- 16 November 2026: gardens outside Denmark get their weather from MET Norway.

## Contact

Questions about privacy: {{contactEmail}}
