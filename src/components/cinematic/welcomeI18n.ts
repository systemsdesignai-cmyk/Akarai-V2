import type { SupportedLanguageCode } from '../../i18n/translations';

export interface CinematicWelcomeStrings {
  brandTagline: string;
  skipBtn: string;
  skipAria: string;
  replayBtn: string;
  replayAria: string;
  getStartedBtn: string;
  setupWorkspaceBtn: string;
  rolePreviewBtn: string;
  languageSelectorAria: string;
  dioramaAria: string;
  tapToExploreHint: string;
  returningSubtitle: string;
  replayCardTitle: string;
  replayCardSub: string;
  pillars: {
    properties: {
      label: string;
      preview: string;
    };
    tenants: {
      label: string;
      preview: string;
    };
    payments: {
      label: string;
      preview: string;
    };
  };
}

export const CINEMATIC_WELCOME_I18N: Record<SupportedLanguageCode, CinematicWelcomeStrings> = {
  en: {
    brandTagline: 'Property & Rent Management',
    skipBtn: 'Skip',
    skipAria: 'Skip cinematic introduction',
    replayBtn: 'Replay',
    replayAria: 'Replay architectural introduction',
    getStartedBtn: 'Get started',
    setupWorkspaceBtn: 'Workspace setup',
    rolePreviewBtn: 'Switch role',
    languageSelectorAria: 'Select application language',
    dioramaAria: 'Interactive miniature Akarai property neighborhood',
    tapToExploreHint: 'Tap a building or drag gently to explore',
    returningSubtitle: 'Calm clarity for every unit',
    replayCardTitle: 'Replay Welcome Experience',
    replayCardSub: 'Watch the Akarai architectural introduction and interactive welcome canvas.',
    pillars: {
      properties: {
        label: 'Properties',
        preview: 'Organize buildings, rooms, and occupancy in one architectural overview.',
      },
      tenants: {
        label: 'Tenants',
        preview: 'Keep tenant profiles, leases, notices, and maintenance requests aligned.',
      },
      payments: {
        label: 'Rent Ledger',
        preview: 'Record rent, track balances accurately, and issue verifiable receipts offline.',
      },
    },
  },
  am: {
    brandTagline: 'የንብረት እና የኪራይ አስተዳደር',
    skipBtn: 'ዝለል',
    skipAria: 'መግቢያውን ዝለል',
    replayBtn: 'ደግመው ይመልከቱ',
    replayAria: 'የመግቢያውን እይታ ደግመው ያጫውቱ',
    getStartedBtn: 'ይጀምሩ',
    setupWorkspaceBtn: 'የሥራ ቦታ ቅንብር',
    rolePreviewBtn: 'ሚና ይቀይሩ',
    languageSelectorAria: 'የመተግበሪያ ቋንቋ ይምረጡ',
    dioramaAria: 'በይነተገናኝ የአካራይ የንብረት ሰፈር እይታ',
    tapToExploreHint: 'ለማሰስ ሕንፃውን ይንኩ ወይም በቀስታ ያንቀሳቅሱ',
    returningSubtitle: 'ለእያንዳንዱ ክፍል ግልጽ ቁጥጥር',
    replayCardTitle: 'የእንኳን ደህና መጡ መግቢያን ደግመው ይመልከቱ',
    replayCardSub: 'የአካራይ የመግቢያ እይታ እና በይነተገናኝ የእንኳን ደህና መጡ ገጽን ይመልከቱ።',
    pillars: {
      properties: {
        label: 'ንብረቶች',
        preview: 'ሕንፃዎችን፣ ክፍሎችን እና የመኖሪያ ሁኔታን በአንድ ግልጽ እይታ ያደራጁ።',
      },
      tenants: {
        label: 'ተከራዮች',
        preview: 'የተከራይ መረጃዎችን፣ ውሎችን፣ ማስታወቂያዎችን እና የጥገና ጥያቄዎችን በሥርዓት ይያዙ።',
      },
      payments: {
        label: 'የኪራይ መዝገብ',
        preview: 'ክፍያዎችን ይመዝግቡ፣ ቀሪ ሒሳብን በትክክል ይከታተሉ እና ከመስመር ውጭ ደረሰኝ ይስጡ።',
      },
    },
  },
  ti: {
    brandTagline: 'ምሕደራ ንብረትን ክራይን',
    skipBtn: 'ዘሊልካ ሕለፍ',
    skipAria: 'መእተዊ ዘሊልካ ሕለፍ',
    replayBtn: 'ደጊምካ ርአ',
    replayAria: 'ናይ መእተዊ ምርኢት ደጊምካ ኣጻውት',
    getStartedBtn: 'ጀምር',
    setupWorkspaceBtn: 'ምድላው ቦታ ስራሕ',
    rolePreviewBtn: 'ተራ ቀይር',
    languageSelectorAria: 'ቋንቋ መተግበሪ ምረጽ',
    dioramaAria: 'ተዋሳኢ ናይ ኣካራይ ሰፈር ንብረት',
    tapToExploreHint: 'ንምድህሳስ ህንጻ ጠውቕ ወይ ብቀስታ ኣንቀሳቕስ',
    returningSubtitle: 'ንነፍሲ ወከፍ ክፍሊ ንጹር ቁጽጽር',
    replayCardTitle: 'መእተዊ እንቋዕ ብደሓን መጻእኩም ደጊምካ ርአ',
    replayCardSub: 'ናይ ኣካራይ ምርኢት መእተዊን ተዋሳኢ ገጽ መቀበሊን ርአ።',
    pillars: {
      properties: {
        label: 'ንብረታት',
        preview: 'ህንጻታት፣ ክፍልታትን ኩነታት መንበርን ብሓደ ንጹር ኣረኣእያ ኣወሃህድ።',
      },
      tenants: {
        label: 'ተኻረይቲ',
        preview: 'መረዳእታ ተኻረይቲ፣ ውዕላት፣ መልእኽትታትን ሕቶታት ጽገናን ብስርዓት ሓዝ።',
      },
      payments: {
        label: 'መዝገብ ክራይ',
        preview: 'ክፍሊታት መዝግብ፣ ዝተረፈ ሕሳብ ብትኽክል ተኸታተል፣ ብዘይ ኢንተርነት ቅብሊት ሃብ።',
      },
    },
  },
  om: {
    brandTagline: 'Bulchiinsa Qabeenyaa fi Kiraa',
    skipBtn: 'Darbi',
    skipAria: 'Seensa suuraa darbi',
    replayBtn: 'Irra deebiʼi',
    replayAria: 'Seensa ijaarsa qabeenyaa irra deebiʼii ilaali',
    getStartedBtn: 'Jalqabi',
    setupWorkspaceBtn: 'Qophii iddoo hojii',
    rolePreviewBtn: 'Gahee jijjiiri',
    languageSelectorAria: 'Afaan appilikeeshinii filadhu',
    dioramaAria: 'Mulʼata naannoo qabeenya Akarai',
    tapToExploreHint: 'Sakattaʼuuf gamoo tuqi ykn suuta sochoosi',
    returningSubtitle: 'Toʼannoo ifaa kutaa hundaaf',
    replayCardTitle: 'Seensa Baga Nagaan Dhuftan Irra Deebiʼi',
    replayCardSub: 'Seensa mulʼata ijaarsa Akarai fi fuula simannaa ilaali.',
    pillars: {
      properties: {
        label: 'Qabeenya',
        preview: 'Gamoowwan, kutaalee fi haala qabannaa bakka tokkotti qindeessi.',
      },
      tenants: {
        label: 'Kiraayitoota',
        preview: 'Odeeffannoo kiraayitootaa, waliigaltee fi gaaffii suphaa sirnaan qabadhu.',
      },
      payments: {
        label: 'Galmee Kiraa',
        preview: 'Kaffaltii galmeessi, haftee sirriitti hordofi, interneetii malees nagahee kenni.',
      },
    },
  },
  ktb: {
    brandTagline: 'Minii Qabeenii fi Kiraa Gashsha',
    skipBtn: 'Saʼi',
    skipAria: 'Egexxa saʼi',
    replayBtn: 'Kaaʼi laʼi',
    replayAria: 'Egexxu laʼishsha kaaʼi laʼi',
    getStartedBtn: 'Egexxi',
    setupWorkspaceBtn: 'Hujii bazza qixxaawo',
    rolePreviewBtn: 'Hujii doʼa soorri',
    languageSelectorAria: 'Afoo doolli',
    dioramaAria: 'Akarai minii bazzu laʼishsha',
    tapToExploreHint: 'Laʼate minne xeqi woy suuta soqqisi',
    returningSubtitle: 'Hunda kifilii xallichu gashsha',
    replayCardTitle: 'Fayyaa Waaʼa Egexxa Kaaʼi Laʼi',
    replayCardSub: 'Akarai minii egexxu laʼishsha kaaʼi ilaali.',
    pillars: {
      properties: {
        label: 'Qabeenna',
        preview: 'Minnuwwa, kifiluwwanna amadama matu bazzan qixxeessi.',
      },
      tenants: {
        label: 'Kiraayitoota',
        preview: 'Kiraayitooti xawishsha, woliigaltinna suuphu xaʼmuwwa qabbi.',
      },
      payments: {
        label: 'Kiraa Mazaagiba',
        preview: 'Baxxancha kitabi, gattota hordofi, interneetii beelam rasiida uwi.',
      },
    },
  },
  hdy: {
    brandTagline: 'Minee kee Kiraa Gashsha',
    skipBtn: 'Saʼi',
    skipAria: 'Asseʼishsha saʼi',
    replayBtn: 'Dabali mooʼi',
    replayAria: 'Akarai asseʼishsha dabali mooʼi',
    getStartedBtn: 'Asseʼi',
    setupWorkspaceBtn: 'Baxxi baxxanchi qixxaawo',
    rolePreviewBtn: 'Baxxi dooʼa soorri',
    languageSelectorAria: 'Afoo doori',
    dioramaAria: 'Akarai minee hegeegi mooʼishsha',
    tapToExploreHint: 'Mooʼate mine amadi woy suuta soqqisi',
    returningSubtitle: 'Hunda kifiliina xallichu gashsha',
    replayCardTitle: 'Fayyaa Waatte Asseʼishsha Dabali Mooʼi',
    replayCardSub: 'Akarai asseʼishshu mooʼishshanna simannaa fuula mooʼi.',
    pillars: {
      properties: {
        label: 'Qabeenna',
        preview: 'Minne, kifiluwwanna amadama matu bazzan qixxeessi.',
      },
      tenants: {
        label: 'Kiraayitoota',
        preview: 'Kiraayitooti xawishsha, woliigaltinna suuphu xaʼmuwwa amadi.',
      },
      payments: {
        label: 'Kiraa Mazaagiba',
        preview: 'Baxxancha kitabi, gattota hordofi, interneetii beela rasiida uwi.',
      },
    },
  },
};
