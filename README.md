# Homebridge Speedeo Connect — 0.1.0-alpha.1

Première version pour le Pentair **Speedeo Connect SPD1**, via le cloud Pentair Pool.
Expose un éclairage marche/arrêt (sortie 1 affectée aux lumières) et la température
d’eau en °C. Ni sortie 2/3, ni contrôle de pompe, ni couleurs, ni température d’air.
Pas d’API locale. Ce projet indépendant n’est pas affilié à Pentair.

## État de validation

La lecture, l’allumage et l’extinction ont été validés sur l’installation de
l’utilisateur avec un outil Python. Le nouveau plugin JavaScript dispose de tests
automatisés avec simulation d’API et de Homebridge ; son authentification réelle,
son exécution dans Homebridge et son contrôle du matériel restent à vérifier chez
l’utilisateur. Aucune connexion réelle au compte n’a été faite pendant le développement.

Le serveur pris en charge est **api.pentair.cloud / us-west-2**, déjà utilisé avec
succès lors de ces essais. Les comptes nécessitant le serveur irlandais ne sont
pas encore pris en charge. Les défis MFA et changement obligatoire de mot de passe
ne sont pas pris en charge.

## Installation locale

Requiert **Node.js 22 ou ultérieur** et **Homebridge 1.8 ou ultérieur**.
Le paquet n’est pas publié sur npm : ne pas installer un paquet homonyme depuis le registre.
Le dépôt GitHub et sa préversion permettent une installation manuelle depuis Homebridge.
La recherche de plugins dans l’interface Homebridge nécessite une publication npm séparée.

Une fois la préversion GitHub publiée, son fichier `.tgz` sera installable
directement par son URL depuis le terminal Homebridge UI. Pour l’image Docker
habituelle  :

```sh
cd /homebridge
npm install --save https://github.com/OSS1117/Homebridge_speedeo_connect/releases/download/v0.1.0-alpha.1/homebridge-speedeo-connect-0.1.0-alpha.1.tgz
```

Le tag est figé : installer une nouvelle alpha nécessitera de changer la version
dans l’URL. Pas de publication npm ni de mise à jour automatique depuis ce dépôt.

Sur **la machine ou dans le conteneur qui exécute Homebridge**, placer le fichier
`homebridge-speedeo-connect-0.1.0-alpha.1.tgz` puis, dans le terminal de Homebridge UI :

```sh
cd /homebridge
npm install --save /homebridge/homebridge-speedeo-connect-0.1.0-alpha.1.tgz
```

Ces commandes ciblent l’image Docker Homebridge habituelle, avec volume persistant
monté dans `/homebridge`. Ne pas utiliser `-g` pour cette installation Docker.
Pour une installation native, utiliser son terminal Homebridge UI et son répertoire
de plugins, avec `npm install -g /chemin/absolu/du/paquet.tgz` si elle utilise des plugins globaux.
Le fichier doit être accessible depuis cet environnement : un chemin du Mac ne
fonctionne pas directement dans Docker ou sur un Raspberry Pi. Utiliser un volume
monté ou transférer le fichier si nécessaire. Installer dans le même environnement
npm que Homebridge. Ne pas installer Homebrew ou Python pour ce plugin.

Après installation, ouvrir la configuration de **Speedeo Connect** dans Homebridge UI,
renseigner le compte Pentair Pool et son mot de passe, sauvegarder, puis redémarrer
Homebridge. Si l’interface ne propose pas la configuration, ajouter dans le tableau
`platforms` existant du config.json, sans remplacer les autres plateformes :

```json
{
  "platform": "SpeedeoConnect",
  "name": "Piscine",
  "email": "VOTRE_EMAIL",
  "password": "VOTRE_MOT_DE_PASSE",
  "pollIntervalSeconds": 30,
  "confirmationSeconds": 600,
  "staleSeconds": 900
}
```

Si un seul SPD1 est associé au compte, il est choisi automatiquement. Sinon ajouter
`deviceId` pour le sélectionner. L’autre appareil IF31 du compte n’est pas piloté.
Ne pas configurer l’ancien plugin sur le même équipement pendant les premiers essais.

Dans Maison, l’accessoire est rattaché au pont Homebridge existant et peut regrouper
l’éclairage et le capteur. Le réglage de séparation des vignettes dépend de Maison.

## Retards et état affiché

Le cloud peut mettre plusieurs minutes à actualiser output1 et light_feedback,
même si l’éclairage a déjà changé physiquement. Le plugin conserve leurs horodatages.

- Au démarrage, aucun état éteint ni température zéro n’est inventé : une lecture
  valide est nécessaire.
- Après acceptation de la commande (`msgs[0].code === 102`), Maison affiche la
  **consigne demandée en attente de confirmation**. Ce choix évite un retour à
  l’ancien état pendant les délais cloud ; il ne prouve pas l’état physique.
- Les anciens retours ne remplacent pas la consigne. Une confirmation nécessite
  des retours concordants datés depuis l’envoi et renouvelés depuis la référence.
- Au-delà de 10 minutes sans confirmation, l’éclairage est signalé indisponible.
  Une confirmation tardive peut rétablir l’état. Aucun renvoi automatique d’ordre.
- Une consigne plus récente provenant du cloud peut remplacer celle en attente,
  notamment après une commande dans l’application officielle.
- Un échec de lecture ou online=false rend les caractéristiques indisponibles.
  Un statut online=true ne suffit pas à valider l’âge des mesures.
- Les données dépassant 15 minutes sont indisponibles. La température a son propre
  horodatage, sa plage est -5 à 45 °C, sans estimation entre mesures.
- Le flag water_temperature_connected=false n’invalide pas seul la température :
  il était présent avec des mesures valides sur l’installation étudiée.

Dans Maison, « Ne répond pas » peut donc désigner des données périmées ou une
confirmation absente, même si le contrôleur reste joignable. Les logs précisent le cas.
Les horloges du système Homebridge et du contrôleur doivent être correctement réglées.

Une coupure réseau au moment d’une écriture peut laisser son exécution incertaine :
le plugin remonte l’erreur et ne réessaie pas. Vérifier dans Pentair Pool ou physiquement.
Les commandes HomeKit successives sont sérialisées, y compris une extinction juste
après un allumage ; elles ne sont pas supprimées sur la base d’un ancien retour.

## Confidentialité

Le mot de passe reste dans la configuration Homebridge comme pour de nombreux
plugins cloud ; protéger cette configuration et ses sauvegardes. Les sessions et
jetons Cognito sont conservés uniquement en mémoire par le plugin. Les logs du
plugin n’incluent pas de jetons, mots de passe, corps API ni identifiants appareil.
Les données passent par Pentair et AWS pour les fonctions cloud.

## Premier essai

1. Vérifier la température dans Maison et dans Pentair Pool.
2. Allumer depuis Maison, puis confirmer visuellement.
3. Vérifier le log « consigne ... acceptée », puis le retour concordant.
4. Éteindre et refaire la vérification. Un délai variable est normal dans les
   observations effectuées ; un ordre accepté ne garantit pas l’action physique.
5. Tester un changement depuis Pentair Pool et observer sa remontée.

## Développement

```sh
npm ci
npm run check
npm test
npm pack
```

Les tests n’envoient aucune commande et n’utilisent aucun compte réel.
Le protocole Speedeo a été identifié dans le bytecode Android fourni par l’utilisateur :
PUT /devicespd-common/speedeo/user/device/{id}, JSON {"payload":{"light_order":true}},
en-tête x-amz-id-token et signature SigV4. L’éclairage appelle updateSpeedeoFields
via SpeedeoCommandFlow. Le code source du plugin est original ; aucun extrait de
l’application, bundle, identifiant de compte ou capture brute n’est distribué.
