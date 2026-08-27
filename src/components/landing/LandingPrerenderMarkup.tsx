/** Static landing HTML for crawlers. Replaced by the SPA after JS loads. */
export function LandingPrerenderMarkup() {
  return (
    <div className="landing-prerender bg-white text-[#0f1623]">
      <header>
        <a href="/">Ulo</a>
        <nav aria-label="Primary">
          <a href="/#how-it-works">How It Works</a>
          <a href="/#features">Features</a>
          <a href="/admin/login">Login</a>
        </nav>
      </header>
      <main>
        <h1>Your tenants text. Ulo does the rest.</h1>
        <p>
          Ulo helps landlords automate day-to-day maintenance, rent collection, and tenant
          communication through SMS workflows. No apps required for tenants or vendors.
        </p>

        <section id="how-it-works">
          <h2>SMS-first maintenance management</h2>
          <p>Less maintenance chaos. More control.</p>
          <ul>
            <li>
              <h3>Tenant Text</h3>
              <p>Maintenance starts with a simple text.</p>
            </li>
            <li>
              <h3>AI organizes</h3>
              <p>Turns requests into organized workflows</p>
            </li>
            <li>
              <h3>Ulo Coordinates</h3>
              <p>Keeps vendors, schedules, and repairs moving.</p>
            </li>
            <li>
              <h3>Track workflow execution</h3>
              <p>
                Landlords can track repair history, vendor performance, repeat issues, maintenance
                costs, timelines, and potential future problems.
              </p>
            </li>
          </ul>
        </section>

        <section id="features">
          <h2>Run your property on autopilot</h2>
          <ul>
            <li>Proactive Maintenance — Ulo builds a maintenance calendar from property data</li>
            <li>Property Insights — workflow data surfaced as actionable portfolio insights</li>
            <li>Rent Collection — automated SMS reminders and payment tracking</li>
            <li>Home Health Check — periodic walkthrough assessments dispatched to technicians</li>
            <li>Maintenance Request — tenant texts an issue, Ulo classifies and coordinates vendors</li>
            <li>Move in Coordination — Ulo guides new tenants through move-in</li>
            <li>Lease Renewals — Ulo monitors expiry dates and launches renewal workflows</li>
          </ul>
        </section>

        <section id="property-dashboard">
          <h2>Maintenance OS for independent landlords</h2>
          <p>
            One view across all your properties; built from every job, text, and vendor interaction.
          </p>
        </section>
      </main>
      <footer>
        <h2>Be first on autopilot</h2>
        <p>Join the alpha pilot program; limited spots available.</p>
        <nav aria-label="Legal">
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
        </nav>
      </footer>
    </div>
  )
}
