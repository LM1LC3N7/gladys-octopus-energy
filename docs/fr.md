# Octopus Energy (Royaume-Uni)

**Connecteur non officiel, sans lien avec Octopus Energy.** Il amène votre
compte Octopus Energy (Grande-Bretagne) dans Gladys : vos compteurs
d'électricité et de gaz, la consommation d'électricité par demi-heure dans le
suivi énergétique de Gladys, le gaz consommé la veille, vos prix du kWh et
abonnements journaliers actuels, et les prix **Agile** publics avec des déclencheurs de scène « heures
les moins chères ». Octopus Energy est une marque d'Octopus Energy Group.
Pour Octopus Energy **France**, utilisez plutôt l'intégration Octopus Energy
France : celle-ci ne parle qu'à l'API britannique.

## Ce que vous obtenez

| Surface                                                   | Contenu                                                                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par point de livraison **électricité** (MPAN) | la consommation par demi-heure pour le suivi énergétique, le prix du kWh actuel (£/kWh, TVA incluse) et l'abonnement (£/jour)                                                |
| Un appareil par point de livraison **gaz** (MPRN)         | le gaz consommé la veille en kWh (un simple capteur, **hors** suivi énergétique : voir plus bas), le prix du kWh actuel et l'abonnement                                      |
| Un appareil **région Agile**                              | prix Agile actuel, prix suivant, moyenne, minimum et maximum du jour, un capteur « période la moins chère » et un capteur « prix négatif »                                   |
| Déclencheurs de scène                                     | **début / fin de la période la moins chère** (les N heures les moins chères du jour), **début d'un prix négatif**, **prix de demain publiés** (vers 16 h, heure britannique) |
| Actions de scène                                          | **prix actuel** et **heures les moins chères** (les N heures consécutives les moins chères des 24 prochaines heures, d'aujourd'hui ou de demain)                             |
| Widget                                                    | **Prix Octopus** : maintenant, ensuite, moyennes, heures les moins chères, prix négatifs, courbe d'aujourd'hui et de demain                                                  |
| Contrat d'énergie (Gladys 5.2+)                           | modèle **Octopus Energy électricité** : chaque demi-heure tarifée au prix du kWh de votre tarif à ce moment, plus l'abonnement                                               |

## Installation

1. Dans votre espace Octopus, ouvrez
   [API access](https://octopus.energy/dashboard/new/accounts/personal-details/api-access) :
   copiez la **clé d'API** (`sk_live_…`) et votre **numéro de compte**
   (`A-XXXXXXXX`).
2. Installez l'intégration, collez les deux, enregistrez, puis cliquez sur
   **Tester la connexion** : vos compteurs, leur tarif et le prix Agile actuel
   s'affichent.
3. Ouvrez **Découverte** et ajoutez les appareils voulus (les compteurs, la
   région Agile).
4. Placez le widget **Prix Octopus** sur un tableau de bord et choisissez la
   région Agile (ou un compteur à tarif par demi-heure).

**Sans compte Octopus**, laissez la clé vide et choisissez une **région des
prix Agile** : vous obtenez l'appareil Agile public, ses déclencheurs et le
widget. Avec un compte, « Automatique » prend la région de votre tarif
d'électricité.

## Suivi énergétique

Les relevés des compteurs communicants arrivent chez Octopus avec du retard
(souvent le lendemain). L'intégration publie donc des demi-heures **datées** :
chaque relevé tombe dans sa propre demi-heure du suivi énergétique, même
arrivé un jour plus tard. Seuls les compteurs dont vous avez créé l'appareil
sont lus. À l'ajout d'un appareil de compteur d'électricité, les 14 derniers
jours sont remplis aussitôt ; ensuite les 3 derniers jours sont relus toutes
les heures, et les 14 jours une fois par jour (après 4 h, heure britannique)
pour les relevés qu'Octopus complète en retard.

**Le gaz n'est pas dans l'onglet énergie** tant que le cœur de Gladys ne gère
pas les contrats gaz : le cœur ajouterait toute consommation de gaz au
compteur d'électricité principal et la chiffrerait au prix de l'électricité.
L'appareil gaz affiche donc seulement **Gas used yesterday (kWh)** (le gaz
consommé la veille), une fois la journée complète, avec son prix du kWh et
son abonnement ; il ne change rien à votre suivi énergétique ni à vos coûts.
Le gaz relevé en mètres cubes (SMETS2) est converti en kWh avec le pouvoir
calorifique de la configuration (×1,02264 ÷ 3,6) ; choisissez kWh pour un
compteur de gaz SMETS1. **Après un changement de compteur de gaz** (nouveau
numéro de série), revérifiez **Unité des relevés du compteur de gaz** : un
SMETS1 remplacé par un SMETS2 passe des kWh aux mètres cubes.

**Vous aviez déjà un appareil gaz avec la version 0.1.2 ou antérieure ?** Son
ancienne fonctionnalité « Consumption (30 min) » était comptée comme de
l'électricité. Ouvrez **Intégrations → Octopus Energy → Découverte** et
cliquez sur **Mettre à jour** sur l'appareil gaz : l'ancienne fonctionnalité
est remplacée par « Gas used yesterday (kWh) ». Tant que vous ne le faites
pas, Gladys garde l'ancienne fonctionnalité (qui ne reçoit plus rien).
Supprimez aussi tout contrat créé depuis l'ancien modèle **Octopus Energy
gaz** : il n'est plus proposé ni tarifé. **Si le gaz apparaît encore dans
l'onglet énergie**, supprimez l'appareil gaz puis rajoutez-le depuis la
Découverte.

Pour voir les coûts de l'électricité, créez un contrat dans **Suivi de
l'énergie → Contrats** depuis le modèle **Octopus Energy électricité**,
rattaché à l'appareil du compteur d'**électricité**. Saisissez l'abonnement affiché par l'appareil. Gladys demande alors à
l'intégration de tarifer chaque demi-heure depuis votre propre historique de
tarifs, changements de tarif compris ; une demi-heure hors de tout contrat du
compte (juste avant le premier, par exemple) prend le contrat le plus proche.

## Scènes

- **Début / fin de la période la moins chère** : la demi-heure actuelle entre
  dans les N heures les moins chères du jour ou en sort (N = **Heures les
  moins chères par jour**, 3 par défaut). Lancer le lave-vaisselle, la
  recharge de la voiture, l'eau chaude.
- **Début d'un prix négatif** : Agile vous paie pour consommer pendant cette
  demi-heure.
- **Prix de demain publiés** : une fois par jour, avec la moyenne, les
  extrêmes, le nombre de demi-heures négatives et la fenêtre la moins chère.

Les actions de scène donnent leurs résultats aux actions suivantes de la
scène, dans leur liste de variables (écrites `{{<étape>.<action>.<clé>}}`,
par exemple `{{0.0.price}}`) : **prix actuel** donne `price`, `cheap`,
`negative`, `next_price`, `avg_price`, `window_start_time`… ; **heures les
moins chères** donne `start_time`, `end_time`, `start` et `end` (dates ISO
pour un « attendre jusqu'à »), `minutes_until_start` et l'économie par
rapport à la période.

## Limites

- Grande-Bretagne uniquement (API d'Octopus Energy UK). **L'Allemagne et
  l'Italie ne sont pas couvertes dans cette version** (leur API Octopus
  fonctionne autrement, avec une connexion par e-mail et mot de passe), ni les
  autres pays Kraken.
- Les tarifs à deux prix (Economy 7) n'ont pas de prix du kWh unique : leur
  fonctionnalité de prix reste vide et leur contrat ne peut pas encore être
  tarifé.
- Les compteurs d'injection (solaire) ne sont pas encore lus.
- Un prix Agile négatif compte comme un coût nul dans les contrats (les coûts
  de Gladys ne peuvent pas être négatifs).
- Appels : le compte toutes les 6 heures (après un échec : 5, 15, puis toutes
  les 60 minutes), la consommation de chaque compteur créé et chaque tarif
  toutes les heures, les prix Agile toutes les heures, à 16 h 02 (heure
  britannique) puis toutes les 15 minutes jusqu'à la publication de ceux de
  demain. Quand Octopus demande de ralentir (429), tous les appels attendent
  le délai demandé (15 minutes sinon).

## Dépannage

- **« Octopus a refusé la clé d'API ou le numéro de compte »** : recopiez-les
  depuis la page API access ; une clé régénérée remplace l'ancienne.
- **« Octopus ne connaît pas ce numéro de compte »** : vérifiez le numéro
  (A-XXXXXXXX) ; l'intégration réessaie après 5, 15, puis toutes les 60
  minutes.
- **« Le compte Octopus n'a pas pu être lu … nouvel essai dans N min »** :
  Octopus était occupé ou injoignable ; rien à faire, l'intégration réessaie.
- **« Octopus ne publie pas ce tarif (404) »** : le produit Agile ou la région
  a changé ; ils sont relus chaque jour.
- **Pas de consommation** : vérifiez que l'appareil du compteur est créé ; les
  données des compteurs communicants peuvent mettre un jour ou plus à
  arriver chez Octopus.
- **Pas d'appareil Agile** : choisissez une région, ou saisissez votre compte
  pour que « Automatique » la lise dans votre tarif.
- Logs : réglez la variable `LOG_LEVEL` de l'intégration.

## Confidentialité

La clé et le numéro de compte sont gardés par Gladys dans sa base, jamais
réaffichés, et envoyés seulement à Octopus. Ils sont masqués dans
l'interface, pas chiffrés : ils sont en clair dans la base de Gladys (donc
aussi dans ses sauvegardes). La clé est envoyée uniquement à
`api.octopus.energy`, et seulement pour les requêtes du compte et de la
consommation (les tarifs et les prix Agile sont publics). Rien n'est
journalisé avec la clé ou le numéro de compte.

## Crédits

La logique des tarifs et des compteurs suit
[BottlecapDave/HomeAssistant-OctopusEnergy](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy)
(MIT, © 2021 David Kendall).
