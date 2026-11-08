# Publier Show Yourself sur le Chrome Web Store

Console : https://chrome.google.com/webstore/devconsole
## État

| Élément | Statut | Fichier |
|---|---|---|
| Zip à envoyer | ✅ | `store/show-yourself-1.2.0.zip` (sans tests ni test.html) |
| Icône 128×128 | ✅ | `icons/icon-128.png` (déjà dans le zip) |
| Captures 1280×800 | ✅ 4 FR + 4 EN, dans l'ordre de l'histoire | `store/screenshots/` |
| Vignette promo 440×280 | ✅ FR + EN | `store/promo-440x280-*.png` |
| Nom + description courte (FR/EN) | ✅ | `_locales/*/messages.json` (lus automatiquement) |
| Description longue FR/EN | ✅ | ci-dessous, à copier-coller |
| Justification des permissions | ✅ | ci-dessous |
| Mini-site (présentation + confidentialité) | ✅ prêt, ❌ **à mettre en ligne** | `store/site/` (index.html + privacy/). Marche sur n'importe quelle adresse. Remplacer `STORE_URL` après publication |
| Compte vérifié (e-mail de contact + frais 5 $ payés) | à vérifier | onglet « Compte » |

### Le carrousel raconte une histoire (garder cet ordre)

1. `story` : Le message a l'air parfait.
2. `link` : Mais le lien ment.
3. `sender` : L'expéditeur aussi.
4. `file` : Et la facture est un programme.

La marque « ParcelGo » est inventée : on n'utilise aucune vraie marque (règle du Store sur les marques déposées).

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
   - Cocher les 3 certifications. URL de confidentialité : https://showyourself.app/privacy/
4. **Distribution** : public, tous les pays.
5. **Envoyer pour examen**. Compter quelques jours, parfois plus : l'accès à tous les sites et aux téléchargements entraîne un examen plus poussé.

Mise à jour plus tard : augmenter `version` dans `manifest.json`, refaire le zip, « Importer un nouveau package ».

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
  > Adds a right-click menu item on images: "reveal the QR code's link". The image is decoded locally (jsQR library bundled in the package).

---

## Description longue EN

```
Why Show Yourself?

Scams don't hack your computer. They hack what you see.

A link that reads "parcelgo.com" but hides a Cyrillic "о". An email signed "service@parcelgo.com" sent from a completely different address. An "invoice.pdf" that is actually a program. Everything looks right, and that is the whole trick.

Show Yourself doesn't guess whether a site is good or bad. It shows you the facts, so you can decide.

🔗 LINKS
• Hover any link: its real destination appears, letter by letter.
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
• Survolez un lien : sa vraie destination apparaît, lettre par lettre.
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
