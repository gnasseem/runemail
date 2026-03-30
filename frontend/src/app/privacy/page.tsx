export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto max-w-4xl px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            Privacy Policy
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Last updated: March 10, 2026
          </p>
        </div>

        {/* Content */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              1. Introduction
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              RuneMail ("we," "our," or "us") values your privacy. This Privacy
              Policy explains how we collect, use, share, and protect your
              information when you use our website, mobile application, and
              services (collectively, the "Service").
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              2. Information We Collect
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
                  2.1 Information You Provide Directly
                </h3>
                <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1">
                  <li>Account credentials (email address, password)</li>
                  <li>Profile information (name, avatar, preferences)</li>
                  <li>Email content you process through our service</li>
                  <li>Communication preferences and settings</li>
                  <li>Customer support inquiries and feedback</li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
                  2.2 Information Collected Automatically
                </h3>
                <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1">
                  <li>Device information (IP address, browser type, OS)</li>
                  <li>
                    Usage data (features accessed, actions taken, time spent)
                  </li>
                  <li>Email open/read events and tracking metadata</li>
                  <li>Gmail metadata (headers, sender info, timestamps)</li>
                  <li>Cookies and similar tracking technologies</li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
                  2.3 Gmail API Data
                </h3>
                <p className="text-slate-600 dark:text-slate-300">
                  RuneMail integrates with Gmail via the Gmail API. We request
                  permission to: read your emails, send emails on your behalf,
                  and manage your drafts. This data is stored securely on our
                  servers (Supabase PostgreSQL) and encrypted in transit.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              3. How We Use Your Information
            </h2>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-2">
              <li>
                Process and analyze emails (categorization, summarization,
                urgency detection)
              </li>
              <li>Generate AI-powered drafts and suggestions</li>
              <li>Detect meetings and manage scheduling</li>
              <li>Send emails and track delivery status</li>
              <li>Provide customer support and respond to inquiries</li>
              <li>Improve service performance and user experience</li>
              <li>Enforce our Terms of Service and legal obligations</li>
              <li>Prevent fraud and unauthorized access</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              4. Data Storage & Security
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Database:
                </strong>{" "}
                Your data is stored in Supabase (PostgreSQL) with Row-Level
                Security (RLS) enabled on all tables. Only your account can
                access your data.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Encryption:
                </strong>{" "}
                Gmail OAuth tokens are encrypted at rest using Fernet
                encryption. Email data is encrypted in transit via HTTPS.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  AI Processing:
                </strong>{" "}
                You can choose to process emails locally in your browser
                (WebLLM) for maximum privacy, or server-side with Google Gemini
                API. Local processing keeps your data on your device.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Backup & Retention:
                </strong>{" "}
                We retain email data for as long as your account is active. You
                may request deletion at any time, and we will remove your data
                within 30 days.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              5. Third-Party Services
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              RuneMail integrates with the following third-party services:
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-2">
              <li>
                <strong>Google Services:</strong> Gmail API, Google Calendar,
                Google Generative AI (Gemini). See{" "}
                <a
                  href="https://policies.google.com/privacy"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google's Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Supabase:</strong> Database and authentication provider.
                See{" "}
                <a
                  href="https://supabase.com/privacy"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Supabase's Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Vercel:</strong> Frontend hosting provider. See{" "}
                <a
                  href="https://vercel.com/legal/privacy-policy"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Vercel's Privacy Policy
                </a>
                .
              </li>
              <li>
                <strong>Supabase:</strong> Edge Functions for background email
                processing. See{" "}
                <a
                  href="https://supabase.com/privacy"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Supabase's Privacy Policy
                </a>
                .
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              6. Data Sharing
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              We do not sell or share your email data with third parties, except
              as required by:
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1">
              <li>Legal obligations or court orders</li>
              <li>Enforcement of our Terms of Service</li>
              <li>Protection of our rights, privacy, or safety</li>
              <li>
                Service providers under confidentiality agreements (e.g.,
                Supabase, Vercel)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              7. Your Rights
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              Depending on your location, you may have the following rights:
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1">
              <li>
                <strong>Right to Access:</strong> Request a copy of your data
              </li>
              <li>
                <strong>Right to Deletion:</strong> Request deletion of your
                account and data
              </li>
              <li>
                <strong>Right to Portability:</strong> Export your data in a
                machine-readable format
              </li>
              <li>
                <strong>Right to Opt-Out:</strong> Disable certain data
                collection practices
              </li>
            </ul>
            <p className="text-slate-600 dark:text-slate-300 mt-3">
              To exercise these rights, contact us at{" "}
              <a
                href="mailto:privacy@runemail.org"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                privacy@runemail.org
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              8. Cookies & Tracking
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              RuneMail uses cookies to:
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1">
              <li>Maintain your session and authentication state</li>
              <li>Store your preferences (theme, AI mode, language)</li>
              <li>Track email opens and engagement (via unique pixel URLs)</li>
              <li>Analyze anonymized usage patterns to improve the service</li>
            </ul>
            <p className="text-slate-600 dark:text-slate-300 mt-3">
              You may opt out of email tracking by disabling it in Settings or
              declining cookies in your browser.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              9. Children's Privacy
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              RuneMail is not intended for children under 13. We do not
              knowingly collect information from children. If we become aware
              that a child under 13 has provided us with personal information,
              we will delete such information and terminate the child's account.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              10. International Users
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              If you are accessing RuneMail from the European Union, the United
              Kingdom, or other regions with data protection laws, your data is
              processed in accordance with the General Data Protection
              Regulation (GDPR) and equivalent local laws. See our
              <a
                href="/privacy"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {" "}
                Data Processing Agreement
              </a>
              for additional details.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              11. Changes to This Policy
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              We may update this Privacy Policy from time to time to reflect
              changes in our practices, technology, legal requirements, or other
              factors. We will notify you by updating the "Last Updated" date
              and, in the case of material changes, by sending you a notice or
              requiring your consent before the changes take effect.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              12. Contact Us
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              If you have questions, concerns, or requests regarding this
              Privacy Policy or our privacy practices, please contact us at:
            </p>
            <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded">
              <p className="text-slate-700 dark:text-slate-200">
                <strong>RuneMail Privacy Team</strong>
                <br />
                Email:{" "}
                <a
                  href="mailto:privacy@runemail.org"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  privacy@runemail.org
                </a>
              </p>
            </div>
          </section>
        </div>

        {/* Footer Navigation */}
        <div className="mt-12 text-center">
          <a
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </main>
  );
}
