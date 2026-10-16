// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object.
// -----------------------------------------------------------------------------

export const T = {
  nothing: {
    en: 'Nothing to read: enter your API key and account number, or choose an Agile region.',
    fr: 'Rien à lire : saisissez votre clé d’API et votre numéro de compte, ou choisissez une région Agile.',
  },
  noAccount: {
    en: 'API key without an account number (A-XXXXXXXX): the meters cannot be read.',
    fr: 'Clé d’API sans numéro de compte (A-XXXXXXXX) : les compteurs ne peuvent pas être lus.',
  },
  badKey: {
    en: 'Octopus refused the API key or the account number: check them on octopus.energy/dashboard/new/accounts/personal-details/api-access.',
    fr: 'Octopus a refusé la clé d’API ou le numéro de compte : vérifiez-les sur octopus.energy/dashboard/new/accounts/personal-details/api-access.',
  },
  noRegion: {
    en: 'No Agile region: choose one in the configuration (or enter your account, the region is then read from your tariff).',
    fr: 'Aucune région Agile : choisissez-en une dans la configuration (ou saisissez votre compte, la région est alors lue dans votre tarif).',
  },
  ok: (meters, region) => ({
    en: `Connected: ${meters} meter${meters > 1 ? 's' : ''}${region ? `, Agile prices of region ${region}` : ''}.`,
    fr: `Connecté : ${meters} compteur${meters > 1 ? 's' : ''}${region ? `, prix Agile de la région ${region}` : ''}.`,
  }),
  unreachable: (message) => ({
    en: `Octopus is unreachable: ${message}. Retrying at the next refresh.`,
    fr: `Octopus est injoignable : ${message}. Nouvel essai au prochain rafraîchissement.`,
  }),
  test: {
    meters: (list) => ({
      en: `Account read: ${list.length > 0 ? list.join('; ') : 'no meter in use'}.`,
      fr: `Compte lu : ${list.length > 0 ? list.join(' ; ') : 'aucun compteur en service'}.`,
    }),
    agile: (region, price) => ({
      en: ` Agile ${region}: ${price === null ? 'no price now' : `${price.toFixed(4)} GBP/kWh now`}.`,
      fr: ` Agile ${region} : ${price === null ? 'pas de prix actuellement' : `${price.toFixed(4)} GBP/kWh actuellement`}.`,
    }),
  },
  widget: {
    now: { en: 'Now', fr: 'Maintenant' },
    next: { en: 'Next', fr: 'Ensuite' },
    today: { en: 'Today avg.', fr: 'Moy. du jour' },
    tomorrow: { en: 'Tomorrow avg.', fr: 'Moy. de demain' },
    cheapest: (hours) => ({ en: `Cheapest ${hours} h`, fr: `${hours} h les moins chères` }),
    negative: { en: 'Negative prices', fr: 'Prix négatifs' },
    negativeCount: (n) => ({
      en: n > 0 ? `${n} half hour${n > 1 ? 's' : ''} ahead` : 'None ahead',
      fr: n > 0 ? `${n} demi-heure${n > 1 ? 's' : ''} à venir` : 'Aucun à venir',
    }),
    tomorrowRow: { en: "Tomorrow's prices", fr: 'Prix de demain' },
    published: { en: 'Published', fr: 'Publiés' },
    notYet: { en: 'Not yet (around 16:00)', fr: 'Pas encore (vers 16 h)' },
    chart: { en: 'Price per kWh', fr: 'Prix par kWh' },
    noData: {
      en: 'No price yet: the integration reads Octopus every hour.',
      fr: 'Pas encore de prix : l’intégration lit Octopus toutes les heures.',
    },
    noDevice: {
      en: 'Pick an Octopus device in the widget settings',
      fr: 'Choisissez un appareil Octopus dans les réglages du widget',
    },
    standing: { en: 'Standing charge', fr: 'Abonnement' },
  },
};
