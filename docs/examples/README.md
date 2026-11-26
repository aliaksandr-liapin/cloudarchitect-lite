# Example designs

What CloudArchitect Lite produces from a plain-English description. Each page has the description, the questions the AI asked, the requirements it worked from, the generated diagram, and what the 26 rules found.

| Example                                                           | What it shows                                                                                                                                                                            | Components | Findings |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| [Serverless Global Blog](myblog.md)                               | A read-heavy serverless blog: a static site and a REST API behind a CDN, welcome emails, and photo thumbnails.                                                                           | 19         | 1        |
| [Online Shop Order Processing](order-events.md)                   | Event-driven order processing: payment, inventory and email each run on their own, with retries and dead-letter queues.                                                                  | 18         | none     |
| [Regional Bank Customer Self-Service Portal](regulated-portal.md) | A bank portal with strict security: WAF and DDoS protection, customer-managed encryption keys, an audit trail and MFA, with containers in private subnets across two Availability Zones. | 23         | 5        |
| [B2B SaaS REST API on AWS](saas-containers.md)                    | A containerised B2B API on Fargate that survives the loss of an Availability Zone, with PostgreSQL, a session cache and rotated database credentials.                                    | 22         | 5        |

All four were generated on 26 November 2026 with Claude Sonnet 5.5 and left exactly as generated. The descriptions are four of the test scenarios in [`eval/scenarios/`](../../eval/scenarios/). Each design is also saved as JSON, so you can open it in the [demo](https://aliaksandr-liapin.github.io/cloudarchitect-lite/) with **Import JSON** and edit it.
