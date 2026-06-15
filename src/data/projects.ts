export interface Project {
  slug: string; // url-safe id
  title: string;
  description: string; // 2-3 sentences
  longDescription?: string; // longer write-up for the card
  tags: string[];
  repo?: string;
  demo?: string;
  featured: boolean;
  status: 'active' | 'complete' | 'archived';
}

export const projects: Project[] = [
  {
    slug: 'finance-dashboard',
    title: 'Finance Dashboard',
    description:
      'A personal finance tracker that pulls bank and card transactions through Plaid, stores them locally in SQLite, and visualizes spending in a Streamlit dashboard.',
    longDescription:
      'A privacy-first personal finance tracker. It connects to bank and card accounts through the Plaid API, syncs transactions into a local SQLite database, and renders an interactive Streamlit dashboard for spending breakdowns, category trends, and cash-flow over time. There are no third-party servers in the loop — every byte of financial data stays on your own machine.',
    tags: ['Python', 'Streamlit', 'Plaid', 'SQLite'],
    repo: 'https://github.com/DevonMT',
    featured: true,
    status: 'active',
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
    featured: true,
    status: 'active',
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
  },
  {
    slug: 'csvkit-tui',
    title: 'csvkit-tui',
    description:
      'A terminal UI for slicing, filtering, and previewing large CSV files without loading them into a spreadsheet. Built for quick data spelunking from the command line.',
    longDescription:
      'A keyboard-driven terminal UI for exploring large CSV files without ever opening a spreadsheet. Built on Textual, it streams rows so multi-gigabyte files open instantly, and supports column filtering, fuzzy search, and live previews — the fastest way to answer a quick question about a data dump from the command line.',
    tags: ['Python', 'Textual', 'CLI'],
    repo: 'https://github.com/DevonMT',
    featured: false,
    status: 'complete',
  },
  {
    slug: 'snippetstash',
    title: 'snippetstash',
    description:
      'A self-hosted snippet manager with full-text search and tagging. A small TypeScript backend over SQLite, designed to be the fastest way to find that one command you wrote six months ago.',
    longDescription:
      'A self-hosted code-snippet manager built to end the search through scrollback and scattered notes. A lean TypeScript backend over SQLite provides full-text search and tag-based filtering, with a minimal web UI for capturing and recalling snippets. Designed around one goal: surface the exact command or block you wrote months ago in under a second.',
    tags: ['TypeScript', 'SQLite', 'Web'],
    repo: 'https://github.com/DevonMT',
    featured: false,
    status: 'archived',
  },
];

export const featuredProjects = projects.filter((p) => p.featured);
