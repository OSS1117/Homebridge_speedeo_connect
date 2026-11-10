Première alpha du plugin Speedeo Connect pour Homebridge.

- Éclairage marche/arrêt de la sortie 1 configurée pour les lumières.
- Température d’eau en °C avec vérification de fraîcheur.
- Commandes via le service dédié Speedeo, signature SigV4, booléen light_order.
- Gestion des retours retardés, délai de confirmation et absence de renvoi automatique.
- Lecture des horodatages par champ ; les états anciens ne remplacent pas une commande en attente.

Les deux commandes ont été validées sur le matériel avec le diagnostic Python.
Le plugin JavaScript passe 23 tests automatisés ; son fonctionnement réel dans
Homebridge et son authentification restent à valider sur l’installation cible.

Requiert Node.js 22+ et Homebridge 1.8+. Serveur api.pentair.cloud / us-west-2.
Pas encore de contrôle des sorties 2/3 ou de la vitesse de pompe.

Pour Docker Homebridge : installer localement le fichier tgz fourni depuis
le dossier persistant /homebridge, sans option npm -g. Voir README.md.
