export default function TermsOfService() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto max-w-4xl px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            Terms of Service
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Last updated: March 10, 2026
          </p>
        </div>

        {/* Content */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              1. Agreement to Terms
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              By accessing and using RuneMail (including our website, mobile
              application, and services), you agree to be bound by these Terms
              of Service ("Terms"). If you do not agree to all of these Terms,
              do not use RuneMail. RuneMail reserves the right to modify or
              discontinue the Service at any time, with or without notice. Your
              continued use of the Service after any changes constitutes your
              acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              2. Use License
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                We grant you a limited, non-exclusive, non-transferable license
                to access and use RuneMail in accordance with these Terms. You
                may not:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>
                  Copy, reproduce, or distribute any content without permission
                </li>
                <li>Use bots, scrapers, or automation to extract data</li>
                <li>
                  Attempt to reverse-engineer, decompile, or hack the Service
                </li>
                <li>Use RuneMail for any illegal or unauthorized purpose</li>
                <li>Harass, threaten, or defame other users</li>
                <li>Upload malware, viruses, or harmful code</li>
                <li>
                  Share your account credentials or allow unauthorized access
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              3. User Accounts
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Registration:
                </strong>{" "}
                To use RuneMail, you must create an account using Google OAuth.
                You must provide accurate, complete information.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Account Security:
                </strong>{" "}
                You are responsible for maintaining the confidentiality of your
                login credentials. RuneMail is not liable for unauthorized
                access to your account due to your negligence.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Account Termination:
                </strong>{" "}
                You may delete your account at any time. We may suspend or
                terminate your account if you violate these Terms or engage in
                abusive behavior.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              4. Gmail & Third-Party Services
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                RuneMail integrates with Google Gmail and other third-party
                services on your behalf. By using RuneMail, you authorize us to:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Access your Gmail account and email data</li>
                <li>Read, analyze, and store email content</li>
                <li>Send emails on your behalf</li>
                <li>Access your Google Calendar for meeting detection</li>
                <li>Manage drafts and scheduled emails</li>
              </ul>
              <p className="mt-3">
                Third-party services are governed by their own terms and privacy
                policies. RuneMail is not responsible for the availability,
                security, or performance of third-party services.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              5. Intellectual Property
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Our Content:
                </strong>{" "}
                RuneMail (including all code, design, logos, trademarks, and
                documentation) is the intellectual property of RuneMail and
                protected by copyright, trademark, and other laws.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Your Content:
                </strong>{" "}
                You retain ownership of your emails and data. By using RuneMail,
                you grant us a license to store, process, and analyze your
                content solely for the purpose of providing the Service.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Open Source:
                </strong>{" "}
                RuneMail's source code is available on{" "}
                <a
                  href="https://github.com/gnn9245/runemail"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
                under an open-source license. See the repository for details.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              6. Payment & Billing
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                RuneMail is currently free. However, we may introduce paid tiers
                in the future. If you subscribe to a paid plan:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Billing occurs at the beginning of each billing cycle</li>
                <li>
                  Payment is non-refundable (except where required by law)
                </li>
                <li>You may cancel your subscription at any time</li>
                <li>We may change pricing with 30 days' notice</li>
              </ul>
              <p className="mt-3">
                All prices are in USD unless otherwise stated. Taxes may apply
                based on your location.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              7. AI Processing & Accuracy
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                RuneMail uses artificial intelligence to categorize, summarize,
                and draft emails. While we strive for accuracy, AI-generated
                content may contain errors or omissions. You remain responsible
                for reviewing all AI-generated content before sending or acting
                on it.
              </p>
              <p>RuneMail is not liable for:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Inaccurate AI categorization or summarization</li>
                <li>Missed urgent emails or important content</li>
                <li>
                  AI-generated drafts that do not match your intended message
                </li>
                <li>
                  Any consequences of sending or relying on AI-generated content
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              8. Disclaimers & Limitations of Liability
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  As-Is Service:
                </strong>{" "}
                RuneMail is provided "as is" without warranties of any kind,
                express or implied, including but not limited to
                merchantability, fitness for a particular purpose, or
                non-infringement.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Availability:
                </strong>{" "}
                We do not guarantee 100% uptime or that the Service will always
                be available or error-free.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Limitation of Damages:
                </strong>{" "}
                To the fullest extent permitted by law, RuneMail shall not be
                liable for any indirect, incidental, special, consequential, or
                punitive damages, including loss of data or revenue, even if
                advised of the possibility of such damages.
              </p>
              <p>
                <strong className="text-slate-800 dark:text-slate-100">
                  Maximum Liability:
                </strong>{" "}
                Our total liability to you shall not exceed the amount you have
                paid to RuneMail in the past 12 months (or $0 if you have not
                paid anything).
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              9. Indemnification
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              You agree to indemnify, defend, and hold harmless RuneMail and its
              officers, directors, employees, and agents from any claims,
              damages, or costs (including attorneys' fees) arising from your
              use of the Service, your violation of these Terms, or your
              infringement of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              10. Data Retention & Deletion
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                RuneMail retains your email data, user information, and other
                records for as long as your account is active. Upon account
                deletion:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>All email data will be deleted within 30 days</li>
                <li>Your account information will be removed</li>
                <li>We may retain anonymized, aggregated data for analytics</li>
                <li>
                  We may retain data as required by law or for legal disputes
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              11. Disputes & Arbitration
            </h2>
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p>
                Any dispute arising out of or relating to these Terms or
                RuneMail shall be governed by and construed in accordance with
                the laws of the United States, without regard to its conflict of
                law provisions.
              </p>
              <p>
                You agree that any legal action or proceeding shall be brought
                exclusively in the state or federal courts located in the United
                States, and you consent to the jurisdiction and venue of such
                courts.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              12. Prohibited Activities
            </h2>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              You agree not to use RuneMail for any of the following:
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1">
              <li>Phishing, scamming, or fraudulent activities</li>
              <li>Distributing malware, spyware, or malicious code</li>
              <li>Hacking, cracking, or attempting unauthorized access</li>
              <li>Stalking, harassment, or threatening behavior</li>
              <li>Spamming or bulk unsolicited messaging</li>
              <li>Copyright infringement or plagiarism</li>
              <li>Violating any applicable laws or regulations</li>
              <li>Circumventing security or rate-limiting mechanisms</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              13. Enforcement
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              RuneMail reserves the right to investigate and enforce these
              Terms. We may:
            </p>
            <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1 mt-3">
              <li>Monitor for violations and abusive behavior</li>
              <li>Suspend or terminate accounts that violate these Terms</li>
              <li>Report suspected illegal activity to authorities</li>
              <li>Pursue legal action against violators</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              14. Modifications to Service
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              RuneMail may modify, suspend, or discontinue the Service (or any
              part thereof) at any time, with or without notice. We are not
              liable to you or any third party for any modification, suspension,
              or discontinuation of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              15. Entire Agreement
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              These Terms, together with our{" "}
              <a
                href="/privacy"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Privacy Policy
              </a>
              , constitute the entire agreement between you and RuneMail
              regarding your use of the Service. If any provision of these Terms
              is found to be invalid or unenforceable, the remaining provisions
              shall remain in full force and effect.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
              16. Contact Us
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              If you have questions or concerns about these Terms of Service,
              please contact us at:
            </p>
            <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded">
              <p className="text-slate-700 dark:text-slate-200">
                <strong>RuneMail Legal Team</strong>
                <br />
                Email:{" "}
                <a
                  href="mailto:legal@runemail.org"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  legal@runemail.org
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
