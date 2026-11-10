# Homebridge Speedeo Connect

Plugin Homebridge pour intégrer le **Pentair Speedeo Connect (SPD1)** à Apple Maison via le cloud Pentair Pool.

- Éclairage : allumage et extinction de la sortie 1 configurée pour les lumières.
- Température de l’eau en °C.

**Version alpha** : premiers essais fonctionnels concluants, validation sur la durée en cours. Projet indépendant, non affilié à Pentair.

## Prérequis

- Homebridge **1.8+** et Node.js **22+**.
- Un Speedeo Connect associé à un compte Pentair Pool.
- Accès Internet. Serveur pris en charge : `api.pentair.cloud` (`us-west-2`).

## Installation

Le plugin est disponible dans les [préversions GitHub](https://github.com/OSS1117/Homebridge_speedeo_connect/releases), pas encore dans le catalogue npm.

Depuis le terminal de l’interface Homebridge, dans le conteneur si vous utilisez Docker :

```sh
npm install -g https://github.com/OSS1117/Homebridge_speedeo_connect/releases/download/v0.1.0-alpha.1/homebridge-speedeo-connect-0.1.0-alpha.1.tgz
```

Redémarrez Homebridge, configurez **Speedeo Connect** dans les plugins, puis sauvegardez et redémarrez.

Cette commande convient aux installations utilisant des plugins globaux, dont le conteneur testé. Si votre instance utilise `/homebridge/node_modules`, installez depuis `/homebridge` avec `npm install --save` à la place de `npm install -g`.

## Configuration

Dans Homebridge UI, renseignez votre compte Pentair Pool et son mot de passe. Un unique Speedeo est détecté automatiquement ; sinon, précisez `deviceId`.

Exemple à ajouter au tableau `platforms` de `config.json` :

```json
{
  "platform": "SpeedeoConnect",
  "name": "Piscine",
  "email": "votre@email.fr",
  "password": "votre-mot-de-passe"
}
```

Options facultatives : `pollIntervalSeconds` (30), `confirmationSeconds` (600), `staleSeconds` (900).

## Fonctionnement et limites

Les retours du cloud peuvent être retardés. Après une commande acceptée, Maison affiche la consigne demandée en attendant sa confirmation. Sans confirmation sous 10 minutes, ou avec des données de plus de 15 minutes, la caractéristique concernée devient indisponible. Ces délais sont configurables ; aucune commande n’est répétée automatiquement.

Les sorties 2 et 3, la vitesse de pompe, les couleurs, les comptes sur le serveur irlandais et l’authentification MFA ne sont pas pris en charge.

Le mot de passe est conservé dans la configuration Homebridge ; protégez ce fichier et ses sauvegardes.

## Développement

```sh
npm ci
npm run check
npm test
```

Licence [MIT](LICENSE).
