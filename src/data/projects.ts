export interface Project {
  slug: string;
  title: string;
  description: string;
  longDescription?: string;
  tags: string[];
  repo?: string;
  demo?: string;
  featured: boolean;
  status: 'active' | 'complete' | 'archived';
  // Homepage card display
  tag: string;
  tagColor: 'accent' | 'amber';
  sparkline: string;
  runtimeNote?: string;
  cardBlurb: string;
}

export const projects: Project[] = [
  {
    slug: 'finance-dashboard',
    title: 'Finance Dashboard',
    description:
      'A personal finance tracker that pulls bank and card transactions through Plaid, stores them locally in SQLite, and visualizes spending in a Streamlit dashboard.',
    longDescription:
      'A privacy-first personal finance tracker. It connects to bank and card accounts through the Plaid API, syncs transactions into a local SQLite database, and renders an interactive Streamlit dashboard for spending breakdowns, category trends, and cash-flow over time. There are no third-party servers in the loop — every byte of financial data stays on the local machine.',
    tags: ['Python', 'Streamlit', 'Plaid', 'SQLite'],
    repo: 'https://github.com/DevonMT/finance-dashboard',
    featured: true,
    status: 'complete',
    tag: 'Python',
    tagColor: 'accent',
    sparkline: '0,34 20,30 40,32 60,22 80,24 100,12 120,16 140,5',
    runtimeNote: '▲ ran in 0.03s',
    cardBlurb:
      "Personal finance, minus the spreadsheet shame. Pulls transactions, categorizes them, and tells me things I'd rather not know.",
  },
  {
    slug: 'games-dashboard',
    title: 'Game Releases Dashboard',
    description:
      'A full-stack dashboard for tracking upcoming and recent game releases, with Claude-powered recommendations ranked against a connected Steam library.',
    longDescription:
      'Pulls game release data from the RAWG API, cross-references it with owned titles via the Steam Web API, and uses Claude Haiku to score and rank upcoming games based on play history and taste profile. Filter by type (AAA, indie, early access) and genre. The backend is a Hono server running on Railway; the frontend is a static Astro page. Game data is cached in SQLite and refreshed on each deploy. A public companion tool lets anyone fill in a quick taste profile and get Claude-brainstormed picks — no account or Steam login required.',
    tags: ['TypeScript', 'Hono', 'Astro', 'Railway', 'Claude AI', 'SQLite'],
    repo: 'https://github.com/DevonMT/games-backend',
    demo: '/games/discover',
    featured: true,
    status: 'complete',
    tag: 'TypeScript',
    tagColor: 'amber',
    sparkline: '0,22 20,8 40,28 60,15 80,30 100,10 120,20 140,5',
    runtimeNote: '▶ try it live',
    cardBlurb:
      "Upcoming game releases ranked against a Steam library by Claude. Because 'what should we play next?' deserved better than vibes.",
  },
  {
    slug: 'media-tracker',
    title: 'Media Recommendation Tracker',
    description:
      'A Streamlit dashboard for tracking watched films and shows, managing streaming platforms, and generating AI-powered viewing recommendations based on watch history.',
    longDescription:
      'Tracks a watch history across movies and shows, then uses Claude Haiku to generate ranked recommendations filtered to active streaming platforms and a configurable rental budget. Recommendations include confidence scores, cast info pulled from TMDB, vibe tags, and optional content sensitivity flags. Built with Streamlit, SQLite, and the Anthropic API.',
    tags: ['Python', 'Streamlit', 'Claude AI', 'SQLite', 'TMDB'],
    repo: 'https://github.com/DevonMT/media-tracker',
    featured: false,
    status: 'complete',
    tag: 'Python',
    tagColor: 'accent',
    sparkline: '0,30 20,26 40,28 60,18 80,20 100,14 120,16 140,8',
    runtimeNote: '▲ ask Claude',
    cardBlurb:
      'Track watch history, get AI-ranked recommendations filtered to the platforms you actually subscribe to. Claude picks. You decide.',
  },
  {
    slug: 'devonmt',
    title: 'devonmt',
    description:
      'A server-rendered personal web app built on Node.js with a clean MVC structure — controllers, middleware, routes, and views — kept deliberately framework-light.',
    longDescription:
      'A from-scratch personal web application built on Node.js with a hand-rolled MVC architecture: dedicated controllers, middleware, routes, and server-side views. No heavyweight framework — just a clear separation of concerns and server-side rendering, used as a sandbox for experimenting with routing patterns, middleware composition, and templating.',
    tags: ['Node.js', 'JavaScript', 'MVC', 'Web'],
    repo: 'https://github.com/ArcheKnight/devonmt',
    featured: false,
    status: 'active',
    tag: 'Node.js',
    tagColor: 'amber',
    sparkline: '0,28 20,10 40,30 60,14 80,26 100,8 120,22 140,12',
    runtimeNote: '▲ ran in 0.05s',
    cardBlurb:
      "Started as 'just a portfolio,' grew into a full Node MVC app with opinions about routing. Classic scope creep, lovingly maintained.",
  },
  {
    slug: 'code-examples-aos',
    title: 'Walmart Workflow Automation',
    description:
      'An internal web platform and VBA macro suite built at Walmart to streamline data analysis and eliminate manual steps for the team.',
    longDescription:
      'A collection of production automation tools built during my time at Walmart. The centerpiece is an internal web platform (JavaScript, HTML, CSS) that enhanced workflow efficiency and was rolled out across the team. Alongside it, a suite of Excel VBA macros — lookup generators, bulk data routines, and custom Outlook rules — reduced repetitive manual work and gave the team faster access to the data they needed for decisions.',
    tags: ['JavaScript', 'HTML', 'CSS', 'Excel VBA', 'Automation'],
    repo: 'https://github.com/ArcheKnight/Code_Examples',
    featured: true,
    status: 'complete',
    tag: 'Automation',
    tagColor: 'accent',
    sparkline: '0,6 20,12 40,9 60,20 80,17 100,28 120,25 140,35',
    runtimeNote: '▼ saved 9 hrs/wk',
    cardBlurb:
      "Made a recurring manual workflow disappear — the good kind of disappear. JavaScript and VBA doing the boring part so nobody else has to.",
  },
];

export const featuredProjects = projects.filter((p) => p.featured);
