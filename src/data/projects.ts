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
    repo: 'https://github.com/DevonMT/finance-dashboard',
    featured: true,
    status: 'complete',
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
];

export const featuredProjects = projects.filter((p) => p.featured);
