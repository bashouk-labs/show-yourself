# Publier Show Yourself

## Les paquets

`node tools/build.js` (depuis la racine) fabrique un zip par famille de navigateurs. Seul le manifest change :

| Zip | Pour | Différences |
|---|---|---|
| `store/show-yourself-<v>-chrome.zip` | Chrome, Edge, Opera | aucune |
| `store/show-yourself-<v>-firefox.zip` | Firefox (AMO) | arrière-plan en « event page », ID Gecko `showyourself@bashouk.com`, aucune donnée collectée déclarée |
| `store/show-yourself-<v>-safari.zip` | Safari (via un Mac) | sans la permission `downloads` (Safari ne l'a pas) |

Limites connues : sur Firefox, un très petit fichier déguisé peut finir de se télécharger avant la pause (Firefox ne prévient qu'après le début). Sur Safari, pas de contrôle des téléchargements ; les pièces jointes et liens de fichiers restent vérifiés dans les pages.

À chaque nouvelle version : augmenter `version` dans `manifest.json`, relancer le build, envoyer le bon zip à chaque store.

---

# Chrome Web Store

Console : https://chrome.google.com/webstore/devconsole
## État

| Élément | Statut | Fichier |
|---|---|---|
| Zip à envoyer | ✅ | `store/show-yourself-1.2.3-chrome.zip` (sans tests, test.html ni tools) |
| Icône 128×128 | ✅ | `icons/icon-128.png` (déjà dans le zip) |
| Captures 1280×800 | ✅ 5 FR + 5 EN, dans l'ordre ci-dessous | `store/screenshots/` |
| Vignette promo 440×280 | ✅ FR + EN | `store/promo-440x280-*.png` |
| Nom + description courte (FR/EN) | ✅ | `_locales/*/messages.json` (lus automatiquement) |
| Description longue FR/EN | ✅ | ci-dessous, à copier-coller |
| Justification des permissions | ✅ | ci-dessous |
| Site (présentation + confidentialité) | ✅ en ligne | https://showyourself.app (aussi dans `homepage_url` du manifest) |
| Compte vérifié (e-mail de contact + frais 5 $ payés) | à vérifier | onglet « Compte » |

### Le carrousel (garder cet ordre)

1. `link` : Le lien ment (lettre cyrillique).
2. `sender` : L'expéditeur aussi.
3. `file` : Et le « PDF » est un programme.
4. `shady-site` : Un site louche ? (fausse adresse au début)
5. `safe-site` : Tous les liens, si vous voulez.

La marque « ParcelGo » est inventée : on n'utilise aucune vraie marque (règle du Store sur les marques déposées).

**Refaire les captures** (après un changement de la bulle ou des textes) : `node store/screenshots/src/capture.mjs` depuis la racine du repo. Il faut Chrome et Node 22+. Les scènes sont dans `store/screenshots/src/scene.html`, et la bulle affichée est la vraie : la page charge le code de l'extension.

## Étapes dans la console

1. **Nouvel élément** : envoyer le zip.
2. **Fiche Play Store** (« Store listing ») :
   - Langue par défaut anglais, puis « Ajouter une langue » : français.
   - Description longue : copier les textes ci-dessous.
   - Catégorie : *Outils* (« Tools »), ou *Confidentialité et sécurité* si proposée.
   - Ajouter les captures et la vignette **de la bonne langue**, dans l'ordre.
   - Site web : https://showyourself.app. E-mail d'assistance : contact@bashouk.com.
3. **Pratiques de confidentialité** :
   - Objectif unique et justifications : copier les textes ci-dessous.
   - Code distant : **Non**. Données collectées : ne rien cocher.
   - Cocher les 3 certifications. URL de confidentialité : https://showyourself.app/en/privacy/
4. **Distribution** : public, tous les pays.
5. **Envoyer pour examen**. Compter quelques jours, parfois plus : l'accès à tous les sites et aux téléchargements entraîne un examen plus poussé.

Mise à jour plus tard : augmenter `version` dans `manifest.json`, relancer `node tools/build.js`, « Importer un nouveau package ».

---

# Microsoft Edge Add-ons

Console : https://partner.microsoft.com/dashboard/microsoftedge/overview (compte gratuit).

1. **Créer une extension** : envoyer `show-yourself-<v>-chrome.zip` (le même que Chrome).
2. **Disponibilité** : public, tous les marchés.
3. **Propriétés** : catégorie *Productivité* ou *Outils*, URL de confidentialité https://showyourself.app/en/privacy/, site https://showyourself.app, e-mail contact@bashouk.com.
4. **Fiches** (EN puis FR) : mêmes descriptions longues et mêmes captures que Chrome. Edge demande en plus une description courte (reprendre celle des `_locales`), l'icône 300×300 est optionnelle.
5. **Envoyer** : examen de quelques jours à une semaine. Dans « Notes pour la certification », coller la justification des permissions ci-dessous.

# Opera (optionnel)

Console : https://addons.opera.com/developer/ . Même zip que Chrome, même fiche. Examen souvent long (plusieurs semaines).

# Firefox (addons.mozilla.org)

Console : https://addons.mozilla.org/developers/ (compte Firefox gratuit).

**Tester avant d'envoyer** (Firefox 140 ou plus récent) :
1. Dézipper `show-yourself-<v>-firefox.zip` dans un dossier.
2. Ouvrir `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire** → choisir le `manifest.json` de ce dossier.
3. Vérifier : la loupe sur `test.html` (et sur un vrai site), le popup, le clic droit « révéler le lien du QR code » sur une image, et un téléchargement déguisé (`facture.pdf.exe`) mis en pause.
4. Le module disparaît quand Firefox se ferme : c'est normal.

`npx web-ext lint --source-dir <dossier>` (outil de Mozilla) vérifie le paquet comme AMO : 0 erreur attendue, 2 avertissements `downloads.onDeterminingFilename` normaux (expliqués dans les notes ci-dessous).

1. **Soumettre une nouvelle extension** → « Sur ce site » (listée publiquement).
2. Envoyer `show-yourself-<v>-firefox.zip`. AMO vérifie le paquet automatiquement et affiche les avertissements.
3. **Code source** : AMO demande si le code est minifié ou généré. Répondre **oui** et joindre les sources (`git archive -o store/source.zip HEAD`), en expliquant :
   > lib/psl.js is generated from the Public Suffix List by tools/build-psl.js (run with Node 22). lib/jsQR.js is the unmodified jsQR build from npm (github.com/cozmo/jsQR). The package is built with `node tools/build.js`.
4. **Fiche** : nom, résumé (description courte), description longue (mêmes textes, ajouter le français dans un 2e temps via « Gérer les langues »), catégorie *Confidentialité et sécurité*, captures, licence **Tous droits réservés** (comme le dépôt GitHub), politique de confidentialité : https://showyourself.app/en/privacy/
5. **Notes pour les examinateurs** : coller la justification des permissions ci-dessous, plus :
   > The two web-ext warnings about downloads.onDeterminingFilename are expected: background.js checks that this event exists before using it, and uses downloads.onCreated on Firefox.
6. Validation automatique en général rapide ; un examen humain peut venir après.

Mise à jour : « Téléverser une nouvelle version » avec le nouveau zip Firefox. Ne jamais changer l'ID Gecko.

# Safari (plus tard, avec un Mac)

Il faut un Mac avec Xcode et un compte Apple Developer (99 $/an). Rien ne peut se faire depuis Windows : le zip est prêt, la suite se passe sur le Mac.

1. Dézipper `show-yourself-<v>-safari.zip` dans un dossier.
2. `xcrun safari-web-extension-converter <dossier> --app-name "Show Yourself" --bundle-identifier com.bashouk.showyourself`
3. Xcode ouvre le projet : régler l'équipe de signature, tester sur Safari (Réglages → Avancé → afficher les fonctions de développement, puis autoriser les extensions non signées).
4. Product → Archive → envoyer sur App Store Connect, remplir la fiche App Store (mêmes textes et captures, aux tailles Mac), envoyer à l'examen.

---

## Objectif unique (Single purpose)

> Show Yourself reveals the true identity of what users are about to trust: the real destination of links (including look-alike letters and hidden redirects), the real address of email senders, disguised file names, and links hidden in QR codes. All analysis is done locally.

## Justification des permissions

- **host_permissions `<all_urls>`**
  > Links, senders and attachments can appear on any website or webmail. The content script must run on every page to analyze an element when the user hovers it. Nothing is read or sent beyond the hovered element, and nothing leaves the device.
- **storage**
  > Stores the user's settings and trusted-sites list locally.
- **scripting**
  > Re-injects the content script into already-open tabs right after install or update, so users don't need to reload their pages.
- **downloads**
  > Checks the name of each download for disguises (e.g. "invoice.pdf.exe", hidden right-to-left characters). A suspicious download is paused and the user decides to keep or cancel it. Nothing else is read.
- **contextMenus**
  > Adds a right-click menu item on images: "reveal the QR code's link". The image is decoded locally (jsQR library bundled in the package). Nothing is downloaded: the page draws the image itself, or, for a cross-origin image, it is cut out of a screenshot of the visible tab taken only at that moment, used in memory and never stored or sent.

---

## Description longue EN

```
Why Show Yourself?

Scams don't hack your computer. They hack what you see.

A link that reads "parcelgo.com" but hides a Cyrillic "о". An email signed "service@parcelgo.com" sent from a completely different address. An "invoice.pdf" that is actually a program. Everything looks right, and that is the whole trick.

Show Yourself doesn't guess whether a site is good or bad. It shows you the facts, so you can decide.

🔗 LINKS
• Hover a suspicious link: its real destination appears, letter by letter. Choose “Always” to see every link.
• Look-alike letters from other alphabets are highlighted.
• Hidden redirects (Outlook Safe Links, Google, trackers…) are unwrapped.
• Slide along the link with the magnifier to inspect each character.

✉️ EMAILS
• Hover a sender's name to see their full address.
• Flags display names that pretend to be an address or a known brand.

📎 DISGUISED FILES
• Names like "invoice.pdf.exe", or names using invisible characters that flip the end of the name, are unmasked.
• Suspicious downloads are paused: you choose to keep or cancel them.

▦ QR CODES
• Right-click an image, then "reveal the QR code's link". Decoded on your computer.

🔒 PRIVACY
• 100% local: no account, no server, no tracking.
• Nothing you browse is stored or sent.

Made by Bashouk Labs · contact@bashouk.com
```

## Description longue FR

```
Pourquoi Show Yourself ?

Les arnaques ne piratent pas votre ordinateur. Elles piratent ce que vous voyez.

Un lien qui affiche « parcelgo.com » mais cache un « о » cyrillique. Un e-mail signé « service@parcelgo.com » envoyé depuis une tout autre adresse. Une « facture.pdf » qui est en réalité un programme. Tout a l'air normal, et c'est justement le piège.

Show Yourself ne devine pas si un site est bon ou mauvais. Il vous montre les faits, pour que vous décidiez.

🔗 LIENS
• Survolez un lien suspect : sa vraie destination apparaît, lettre par lettre. Choisissez « Toujours » pour voir tous les liens.
• Les lettres d'autres alphabets qui imitent les nôtres sont mises en évidence.
• Les redirections cachées (Outlook Safe Links, Google, traqueurs…) sont dévoilées.
• Glissez sur le lien avec la loupe pour inspecter chaque caractère.

✉️ E-MAILS
• Survolez le nom d'un expéditeur pour voir son adresse complète.
• Signale les noms affichés qui imitent une adresse ou une marque connue.

📎 FICHIERS DÉGUISÉS
• Les noms comme « facture.pdf.exe », ou ceux qui utilisent un caractère invisible pour retourner la fin du nom, sont démasqués.
• Les téléchargements suspects sont mis en pause : vous choisissez de les garder ou de les annuler.

▦ QR CODES
• Clic droit sur une image, puis « révéler le lien du QR code ». Décodé sur votre ordinateur.

🔒 VIE PRIVÉE
• 100 % local : pas de compte, pas de serveur, aucun pistage.
• Rien de ce que vous consultez n'est enregistré ni envoyé.

Par Bashouk Labs · contact@bashouk.com
```
