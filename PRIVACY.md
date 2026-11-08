# Show Yourself · Privacy Policy / Politique de confidentialité

_Last updated / Dernière mise à jour : 2026-11-06_

## English

Show Yourself analyzes links **entirely on your computer**.

- **No data is collected, sold or shared.** The extension never sends your data
  anywhere. Its only network request is the one described under `contextMenus` below,
  and it happens only when you ask for it.
- Links you hover or click are analyzed in memory and immediately forgotten.
  Their addresses are never stored or transmitted.
- The extension stores only the following, locally on your device
  (`chrome.storage.local`), and never sends it anywhere:
  - your settings (for example, "block clicks on traps": on/off);
  - the list of sites you marked as "I know this site";
  - an anonymous daily counter (number of traps spotted and clicks blocked,
    with no addresses), kept for 30 days.
- Uninstalling the extension deletes all of this data.

**Permissions**
- `storage`: saves the settings, trusted sites and counter listed above.
- Access to all websites (content script): needed to inspect the links, e-mail senders
  and attachment names on every page you visit, including webmail. Nothing is read or
  sent beyond those.
- `scripting`: adds the inspector to tabs that were already open when the extension is
  installed or updated, so you don't have to reload them.
- `downloads`: checks the NAME of each file you download; a disguised file
  (e.g. invoice.pdf.exe) is paused and you choose to delete or keep it. File contents
  are never read.
- `contextMenus`: adds "reveal the QR code's link" to the right-click menu on images.
  The image is decoded on your computer (bundled jsQR library); nothing is uploaded.
  If the page does not let the extension read the image directly, the extension downloads
  that image again from its public address, without your cookies, to decode it. Local and
  private-network addresses are never contacted.

**No third parties.** No analytics, no advertising, no tracking, no account.
The extension contains no remote code: everything it runs is in the package.

**Your rights (GDPR).** Since no personal data reaches us, there is nothing for us
to access, correct or delete. Everything stays on your device; uninstalling the
extension erases it.

**Children.** The extension collects no data from anyone, including children.

**Changes.** Any change to this policy will be published on this page with a new
date. If the extension ever needed to send data, it would ask you first.

Publisher: Bashouk Labs · https://showyourself.app · contact@bashouk.com

## Français

Show Yourself analyse les liens **entièrement sur votre ordinateur**.

- **Aucune donnée n'est collectée, vendue ni partagée.** L'extension n'envoie jamais
  vos données nulle part. Sa seule requête réseau est celle décrite à `contextMenus`
  ci-dessous, et seulement quand vous la demandez.
- Les liens survolés ou cliqués sont analysés en mémoire puis immédiatement oubliés.
  Leurs adresses ne sont jamais enregistrées ni transmises.
- L'extension enregistre uniquement les éléments suivants, localement sur votre
  appareil (`chrome.storage.local`), et ne les envoie jamais nulle part :
  - vos réglages (par exemple « bloquer le clic sur les pièges » : activé ou non) ;
  - la liste des sites que vous avez marqués « Je connais ce site » ;
  - un compteur quotidien anonyme (nombre de pièges repérés et de clics bloqués,
    sans aucune adresse), conservé 30 jours.
- Désinstaller l'extension supprime toutes ces données.

**Permissions**
- `storage` : enregistre les réglages, les sites de confiance et le compteur ci-dessus.
- Accès à tous les sites (script de contenu) : nécessaire pour inspecter les liens, les
  expéditeurs et les noms des pièces jointes de chaque page, y compris dans les webmails.
  Rien d'autre n'est lu ni envoyé.
- `scripting` : ajoute l'inspecteur aux onglets déjà ouverts lors de l'installation ou d'une
  mise à jour, pour ne pas avoir à les recharger.
- `downloads` : vérifie le NOM de chaque fichier téléchargé ; un fichier déguisé
  (ex. facture.pdf.exe) est mis en pause et vous choisissez de le supprimer ou de le garder.
  Le contenu des fichiers n'est jamais lu.
- `contextMenus` : ajoute « révéler le lien du QR code » au clic droit sur une image.
  L'image est décodée sur votre ordinateur (bibliothèque jsQR incluse) ; rien n'est envoyé.
  Si la page ne permet pas à l'extension de lire l'image directement, l'extension
  retélécharge cette image depuis son adresse publique, sans vos cookies, pour la décoder.
  Les adresses locales ou de réseau privé ne sont jamais contactées.

**Aucun tiers.** Pas de statistiques, pas de publicité, pas de pistage, pas de compte.
L'extension ne contient aucun code distant : tout ce qu'elle exécute est dans le paquet.

**Vos droits (RGPD).** Aucune donnée personnelle ne nous parvient : il n'y a donc rien
à consulter, corriger ou supprimer chez nous. Tout reste sur votre appareil ;
désinstaller l'extension l'efface.

**Enfants.** L'extension ne collecte aucune donnée, sur personne, enfants compris.

**Modifications.** Tout changement de cette politique sera publié sur cette page avec
une nouvelle date. Si l'extension devait un jour envoyer des données, elle vous le
demanderait d'abord.

Éditeur : Bashouk Labs · https://showyourself.app · contact@bashouk.com
