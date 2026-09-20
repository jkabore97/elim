// Curated translations for the app's fixed data lists — church departments
// ("Chorale / Louange"), professions ("Infirmier / Sage-femme") and country
// names. These are authored in one language and stored that way on the
// profile (the stored value never changes, so existing profiles and any
// filtering keep working); only the label shown to the reader is translated.
//
// French <-> English is covered here directly, so it is instant and works
// offline — no translation API call, no waiting, no failure to fall back
// from. Other languages still go through the runtime translator (see
// TValue / translate.ts); this map is the reliable shortcut for the two
// languages the ELIM community actually uses.

// Professions — French (the authored/stored language) -> English.
export const EN_PROFESSION: Record<string, string> = {
  'Agriculteur / Éleveur': 'Farmer / Herder', 'Artisan': 'Craftsperson',
  'Commerçant': 'Trader / Merchant', 'Chauffeur': 'Driver',
  'Enseignant': 'Teacher', 'Étudiant': 'Student', 'Fonctionnaire': 'Civil servant',
  'Infirmier / Sage-femme': 'Nurse / Midwife', 'Informaticien': 'IT specialist',
  'Ingénieur': 'Engineer', 'Journaliste': 'Journalist', 'Juriste / Avocat': 'Lawyer',
  'Médecin': 'Doctor', 'Militaire / Sécurité': 'Military / Security',
  'Ménagère / Au foyer': 'Homemaker', 'Ouvrier': 'Manual worker',
  'Pasteur / Ministre': 'Pastor / Minister', 'Pharmacien': 'Pharmacist',
  'Retraité': 'Retired', 'Sans emploi': 'Unemployed', 'Secrétaire': 'Secretary',
  'Technicien': 'Technician', 'Autre': 'Other',
}

// Church departments / interests — French -> English.
export const EN_INTEREST: Record<string, string> = {
  'Chorale / Louange': 'Choir / Worship', 'Musique / Instruments': 'Music / Instruments',
  'Intercession / Prière': 'Intercession / Prayer', 'Évangélisation': 'Evangelism',
  'École du dimanche': 'Sunday school', 'Jeunesse': 'Youth', 'Femmes': 'Women',
  'Hommes': 'Men', 'Accueil / Protocole': 'Welcome / Protocol',
  'Sonorisation / Technique': 'Sound / Technical', 'Média / Communication': 'Media / Communication',
  'Action sociale': 'Social action', 'Santé': 'Health', 'Finances': 'Finance',
  'Logistique': 'Logistics', 'Enseignement': 'Teaching',
}

// Country names — English (the authored/stored language) -> French. Anything
// not listed falls back to its English name, so the list is never broken,
// only progressively better.
export const FR_COUNTRY: Record<string, string> = {
  'Burkina Faso': 'Burkina Faso', 'Ivory Coast': "Côte d'Ivoire", 'Mali': 'Mali',
  'Niger': 'Niger', 'Senegal': 'Sénégal', 'Ghana': 'Ghana', 'Togo': 'Togo',
  'Benin': 'Bénin', 'Guinea': 'Guinée', 'Guinea-Bissau': 'Guinée-Bissau',
  'Sierra Leone': 'Sierra Leone', 'Liberia': 'Libéria', 'Gambia': 'Gambie',
  'Mauritania': 'Mauritanie', 'Nigeria': 'Nigéria', 'Cameroon': 'Cameroun',
  'Chad': 'Tchad', 'Gabon': 'Gabon', 'Congo (Brazzaville)': 'Congo (Brazzaville)',
  'Democratic Republic of the Congo': 'République démocratique du Congo',
  'Central African Republic': 'République centrafricaine', 'Morocco': 'Maroc',
  'Algeria': 'Algérie', 'Tunisia': 'Tunisie', 'Egypt': 'Égypte',
  'South Africa': 'Afrique du Sud', 'Kenya': 'Kenya', 'Rwanda': 'Rwanda',
  'Burundi': 'Burundi', 'Cabo Verde': 'Cap-Vert', 'Djibouti': 'Djibouti',
  'Madagascar': 'Madagascar', 'Comoros': 'Comores', 'Equatorial Guinea': 'Guinée équatoriale',
  'Sao Tome and Principe': 'Sao Tomé-et-Principe', 'Angola': 'Angola',
  'Mozambique': 'Mozambique', 'Tanzania': 'Tanzanie', 'Uganda': 'Ouganda',
  'Ethiopia': 'Éthiopie', 'Somalia': 'Somalie', 'Sudan': 'Soudan',
  'South Sudan': 'Soudan du Sud', 'Zambia': 'Zambie', 'Zimbabwe': 'Zimbabwe',
  'Malawi': 'Malawi', 'Botswana': 'Botswana', 'Namibia': 'Namibie',
  'France': 'France', 'Belgium': 'Belgique', 'Switzerland': 'Suisse',
  'Italy': 'Italie', 'Germany': 'Allemagne', 'Spain': 'Espagne',
  'Portugal': 'Portugal', 'Netherlands': 'Pays-Bas', 'United Kingdom': 'Royaume-Uni',
  'Ireland': 'Irlande', 'Canada': 'Canada', 'United States': 'États-Unis',
  'Brazil': 'Brésil', 'China': 'Chine', 'India': 'Inde', 'Japan': 'Japon',
  'Turkey': 'Turquie', 'Lebanon': 'Liban', 'Saudi Arabia': 'Arabie saoudite',
  'United Arab Emirates': 'Émirats arabes unis', 'Qatar': 'Qatar',
  'Greece': 'Grèce', 'Sweden': 'Suède', 'Norway': 'Norvège', 'Denmark': 'Danemark',
  'Austria': 'Autriche', 'Poland': 'Pologne', 'Russia': 'Russie', 'Australia': 'Australie',
}

// French-authored values (departments + professions) keyed for French->English.
const FR_TO_EN: Record<string, string> = { ...EN_PROFESSION, ...EN_INTEREST }

// A curated, instant translation for a fixed-list value, or null when there
// isn't one (the caller then falls back to the runtime translator).
// `source` is the language the value was authored in.
export function curatedValue(text: string, source: 'fr' | 'en', target: string): string | null {
  if (!text) return text
  if (target === source) return text
  if (source === 'fr' && target === 'en') return FR_TO_EN[text] ?? null
  if (source === 'en' && target === 'fr') return FR_COUNTRY[text] ?? null
  return null
}
