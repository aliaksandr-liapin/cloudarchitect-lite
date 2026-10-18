# Review packet, group 4

Scenarios in this packet: claims-approval-workflow, order-events, k8s-microservices. Read `reviewer-instructions.md` for the task and the output format.

## Rubric

Score each design on seven dimensions, each 0-3 (0 = critical defect, 3 = production-grade for an MVP-level design).

| Dimension | What is checked |
|---|---|
| requirementCoverage | All explicit requirements are reflected; assumptions are marked |
| serviceFitness | Service choices are justified; nothing redundant or expensive without reason |
| connectionCorrectness | Direction, semantics, protocols and integrations are correct |
| securityBaseline | Auth, least privilege, private data not public, encryption |
| reliabilityOperability | Error handling, DLQs, observability, fault tolerance |
| costAwareness | No obvious overspend; serverless/managed where appropriate |
| explanationAccuracy | Rationale and connection descriptions are technically correct |

**Critical defect:** any dimension scored 0, or any incorrect technical statement that would lead the user to an insecure or non-working solution.

**Defect severities:** `minor` (cosmetic or small improvement), `major` (a real weakness or wrong detail that a careful architect would fix before building), `critical` (see above).

**Documentation rule:** every `major` or `critical` defect must cite an official AWS documentation or Well-Architected URL in its `evidence` field. A claim you cannot support with documentation should be recorded as `minor`.

---

## Scenario: claims-approval-workflow

**User prompt**

> Customers submit insurance claims with photos and PDF documents through a web form. Each claim goes through automated checks, then waits up to 14 days for an adjuster to approve or reject it, then the customer is emailed the decision. Every step must be auditable and the process must resume correctly after failures.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Customers submit insurance claims with photos and PDF documents through a web form
- R2 [functional, confirmed] Each claim goes through automated checks after submission
- R3 [functional, confirmed] Each claim waits up to 14 days for an adjuster to approve or reject it
- R4 [functional, confirmed] The customer is emailed the decision after the adjuster approves or rejects the claim
- R5 [non-functional, confirmed] Every step of the claim process must be auditable
- R6 [non-functional, confirmed] The process must resume correctly after failures without losing or duplicating claim progress
- R7 [functional, inferred] Claim submissions must be durably stored with their photos and PDF documents
- R8 [functional, inferred] Adjusters need a way to review pending claims and record approve or reject decisions
- R9 [functional, inferred] A claim not decided within 14 days must trigger a defined timeout outcome
- R10 [functional, inferred] Uploaded photos and PDFs must be validated for type and size before automated checks run
- R11 [constraint, inferred] Audit records must be tamper-evident and retained for later review
- R12 [non-functional, inferred] Customer personal and claim data must be encrypted in transit and at rest
- C-auth-methods [functional, inferred] How should customers and adjusters sign in to the system? (decided by the architect)
- C-user-scale [functional, inferred] How many claims per month and how many concurrent adjusters are expected? (decided by the architect)
- C-data-retention [functional, inferred] How long must claims, documents, and audit records be retained? (decided by the architect)
- I1 [non-functional, inferred] Customers and adjusters must authenticate; adjuster access restricted to an adjuster group
- I2 [constraint, inferred] Claim records and documents are retained for a defined period (assumed 7 years) with backups for recovery
- I3 [non-functional, inferred] Failed or rejected-input processing must be alarmed and visible to operators

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Primary Region (Region) [region]

**Nodes**

- **Customer browser** [customer] - EXTERNAL user: Customer
  - purpose: Submits claim web form and uploads files
  - rationale: Claim submitter
  - satisfies: R1
- **Adjuster browser** [adjuster] - EXTERNAL user: Adjuster
  - purpose: Reviews pending claims and records decisions
  - rationale: Claim reviewer
  - satisfies: R8
- **CloudFront** [cf] - service: Amazon CloudFront
  - purpose: Serves web form and adjuster UI over HTTPS
  - rationale: TLS and caching for static site
  - satisfies: R1, R8, R12
- **Web site bucket** [site] - service: Amazon S3
  - purpose: Hosts static web form and adjuster app
  - rationale: Simple static hosting, private behind OAC
  - configuration encryption: KMS
  - satisfies: R1, R8
- **Cognito user pool** [cognito] - service: Amazon Cognito
  - purpose: Sign-in for customers and adjusters
  - rationale: Managed authentication with adjuster group
  - satisfies: I1, R8
- **WAF** [waf] - service: AWS WAF
  - purpose: Protects the public API
  - rationale: Web firewall on REST API
  - satisfies: R12, I1
- **Claims API** [api] - service: Amazon API Gateway
  - purpose: Submit claims, get upload URLs, list pending claims, record decisions
  - rationale: REST API supports WAF and Cognito authorizer
  - configuration apiType: REST
  - configuration authorizer: Cognito user pool
  - satisfies: R1, R8, I1
- **Claims API handler** [apifn] - service: AWS Lambda
  - purpose: Creates claim record, issues presigned URLs, lists claims, completes decision callback
  - rationale: Serverless backend logic
  - satisfies: R1, R8, R6
- **Claims table** [claims] - service: Amazon DynamoDB
  - purpose: Stores claim metadata, status and decisions
  - rationale: Durable key-value store with conditional writes for idempotency
  - configuration encryption: KMS
  - configuration backup: PITR
  - satisfies: R7, R6, R8, I2, R12
- **Claim documents bucket** [docs] - service: Amazon S3
  - purpose: Durable storage of photos and PDFs
  - rationale: Durable object storage with versioning
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R7, R1, I2, R12
- **Upload validator** [validate] - service: AWS Lambda
  - purpose: Checks file type and size, then starts the claim workflow
  - rationale: Validation before automated checks
  - satisfies: R10, R6
- **Validation DLQ** [dlq] - service: Amazon SQS
  - purpose: Holds events that failed processing
  - rationale: Failed async events are captured and alarmed
  - configuration encryption: KMS
  - satisfies: R6, I3
- **Claim workflow** [sfn] - service: AWS Step Functions
  - purpose: Orchestrates checks, 14-day wait for decision, timeout and notification
  - rationale: Durable state, callbacks, retries and execution history
  - satisfies: R2, R3, R6, R9, R5, R4
- **Automated checks** [checks] - service: AWS Lambda
  - purpose: Runs automated claim checks
  - rationale: Idempotent check step
  - satisfies: R2, R6
- **Decision notifier** [notify] - service: AWS Lambda
  - purpose: Sends decision or timeout email
  - rationale: Idempotent notification step
  - satisfies: R4, R9, R6
- **SES** [ses] - service: Amazon SES
  - purpose: Emails the customer the decision
  - rationale: Managed email sending
  - satisfies: R4
- **KMS keys** [kms] - service: AWS KMS
  - purpose: Customer managed keys for data at rest
  - rationale: Encryption control
  - satisfies: R12, R11
- **CloudTrail** [trail] - service: AWS CloudTrail
  - purpose: Audit log of API and data events with integrity validation
  - rationale: Tamper-evident audit
  - satisfies: R5, R11
- **Audit log bucket** [auditbkt] - service: Amazon S3
  - purpose: Retains CloudTrail logs and digests
  - rationale: Long-term retention
  - configuration encryption: KMS
  - configuration backup: versioning
  - satisfies: R11, R5, I2
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - purpose: Logs, metrics and alarms including DLQ depth and failed executions
  - rationale: Observability
  - satisfies: I3, R5, R6

**Edges**

- Customer browser -> CloudFront (invoke, HTTPS): Load web form
  - satisfies: R1, R12
- Adjuster browser -> CloudFront (invoke, HTTPS): Load adjuster app
  - satisfies: R8, R12
- CloudFront -> Web site bucket (origin, HTTPS): Static content
  - configuration originAccess: OAC
  - satisfies: R1, R8
- Customer browser -> Claims API (invoke, HTTPS): Submit claim, get upload URLs
  - satisfies: R1, I1
- Adjuster browser -> Claims API (invoke, HTTPS): List claims, decide
  - satisfies: R8, I1
- Cognito user pool -> Claims API (other, HTTPS): JWT authorization
  - satisfies: I1
- WAF -> Claims API (other, HTTPS): Protects API
  - satisfies: R12
- Claims API -> Claims API handler (invoke, HTTPS): Proxy integration
  - satisfies: R1, R8
- Claims API handler -> Claims table (write, HTTPS): Create claim, record decision
  - satisfies: R7, R8, R6
- Customer browser -> Claim documents bucket (write, HTTPS): Upload files via presigned URL
  - configuration presignedUrl: Short-lived URL issued by API handler per file
  - satisfies: R1, R7
- Claim documents bucket -> Upload validator (event, S3 event): ObjectCreated
  - configuration eventNotification: ObjectCreated
  - configuration failureDestination: Validation DLQ
  - satisfies: R10
- Upload validator -> Claim workflow (invoke, HTTPS): Start execution named by claim ID
  - satisfies: R2, R6
- Upload validator -> Validation DLQ (event, SQS): Failed invocations
  - configuration failureDestination: Validation DLQ
  - satisfies: R6, I3
- Claim workflow -> Automated checks (invoke, HTTPS): Run checks with retries
  - satisfies: R2, R6
- Claim workflow -> Claims table (write, HTTPS): Store task token and status
  - satisfies: R3, R6, R5
- Claims API handler -> Claim workflow (invoke, HTTPS): SendTaskSuccess with decision
  - satisfies: R3, R8
- Claim workflow -> Decision notifier (invoke, HTTPS): Notify decision or timeout
  - satisfies: R4, R9
- Decision notifier -> SES (invoke, HTTPS): Send email
  - satisfies: R4
- CloudTrail -> Audit log bucket (write, HTTPS): Deliver signed log files
  - satisfies: R5, R11
- Claim workflow -> CloudWatch (write, HTTPS): Execution logs and metrics
  - satisfies: R5, I3
- Validation DLQ -> CloudWatch (write, HTTPS): DLQ depth alarm
  - satisfies: I3
- KMS keys -> Claim documents bucket (other, HTTPS): Encrypts documents
  - satisfies: R12
- KMS keys -> Claims table (other, HTTPS): Encrypts claims
  - satisfies: R12

### Design B

**Requirements**

- R1 [functional, confirmed] Customers submit insurance claims with photos and PDF documents through a web form.
- R2 [functional, confirmed] Each submitted claim goes through automated checks.
- R3 [functional, confirmed] Each claim waits up to 14 days for an adjuster to approve or reject it.
- R4 [functional, confirmed] The customer is emailed the decision after the adjuster approves or rejects the claim.
- R5 [non-functional, confirmed] Every step of the claim process must be auditable.
- R6 [non-functional, confirmed] The claim process must resume correctly after failures.
- R7 [functional, inferred] Uploaded photos and PDF documents must be stored durably and linked to their claim.
- R8 [functional, inferred] An adjuster must be able to access submitted claims and their documents to make a decision.
- R9 [functional, inferred] A claim that receives no adjuster decision within 14 days must be escalated or closed by a defined rule.
- R10 [constraint, inferred] Audit records must be tamper-evident and retained for later review.
- R11 [non-functional, inferred] Each claim must be processed exactly once even when retries occur.
- C-auth-methods [functional, inferred] How should customers and adjusters sign in to the claim system? (decided by the architect)
- C-user-scale [functional, inferred] What is the expected volume of claims and concurrent users? (decided by the architect)
- C-data-retention [functional, inferred] How long must claims, documents, and audit records be kept? (decided by the architect)
- I1 [constraint, inferred] Encrypt claim data in transit with TLS and at rest with a customer managed KMS key.
- I2 [non-functional, inferred] Protect the public entry point with WAF and require strong sign-in for customers and adjusters, with separate user pools and least-privilege access.
- I3 [non-functional, inferred] Alarm on failed workflow steps, audit write failures and dead-letter queue depth so stuck claims are noticed.

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-aws]
  - Primary Region (Region) [c-region]

**Nodes**

- **Customer** [n-customer] - EXTERNAL user: Customer browser
  - purpose: Submits claims and uploads photos and PDFs
  - rationale: Entry point of the claim process
  - satisfies: R1, C-auth-methods
- **Adjuster** [n-adjuster] - EXTERNAL user: Adjuster browser
  - purpose: Reviews claims, documents and makes decisions
  - rationale: Internal staff using a separate interface
  - satisfies: R8, C-auth-methods
- **Customer inbox** [n-inbox] - EXTERNAL third-party: Customer email inbox
  - purpose: Receives the decision email
  - rationale: Delivery target of the decision notice
  - satisfies: R4
- **CloudFront** [n-cf] - service: Amazon CloudFront
  - in container: AWS Cloud
  - purpose: Serves the web form and adjuster UI over HTTPS
  - rationale: Global edge TLS termination for the front ends
  - satisfies: R1, R8, I1
- **Web app bucket** [n-web] - service: Amazon S3
  - in container: Primary Region
  - purpose: Hosts static customer and adjuster front ends
  - rationale: Private static origin reached only through CloudFront
  - satisfies: R1, R8
- **AWS WAF** [n-waf] - service: AWS WAF
  - in container: Primary Region
  - purpose: Filters malicious requests to the REST API
  - rationale: WAF attaches to REST API stages, so a REST API is used
  - satisfies: R1, R8, I2
- **REST API** [n-api] - service: Amazon API Gateway
  - in container: Primary Region
  - purpose: Exposes claim submission, upload URL, claim view and decision endpoints
  - rationale: REST type supports WAF and Cognito authorizers
  - configuration apiType: REST
  - configuration authorizer: Cognito user pools
  - satisfies: R1, R7, R8, C-auth-methods, I2
- **Cognito user pools** [n-cognito] - service: Amazon Cognito
  - in container: Primary Region
  - purpose: Signs in customers and adjusters in separate pools
  - rationale: Managed sign-in with MFA for adjusters
  - satisfies: C-auth-methods, I2
- **Claim API handler** [n-api-fn] - service: AWS Lambda
  - in container: Primary Region
  - purpose: Creates claims, issues upload URLs, returns claim views and resumes the workflow with adjuster decisions
  - rationale: Serverless request handling; claim id is the idempotency key
  - satisfies: R1, R6, R7, R8, R11
- **Claim documents bucket** [n-docs] - service: Amazon S3
  - in container: Primary Region
  - purpose: Durably stores photos and PDFs linked to each claim
  - rationale: Versioned, KMS encrypted and private
  - configuration backup: versioning
  - configuration encryption: KMS
  - satisfies: R7, R10, C-data-retention, I1
- **Claims table** [n-claims] - service: Amazon DynamoDB
  - in container: Primary Region
  - purpose: Stores claim records, status and document links
  - rationale: Key-value store with streams that feed the audit trail
  - configuration backup: PITR
  - configuration encryption: KMS
  - satisfies: R1, R5, R6, R11, C-user-scale, I1
- **Claim workflow** [n-wf] - service: AWS Step Functions
  - in container: Primary Region
  - purpose: Runs automated checks, waits up to 14 days for the adjuster, escalates on timeout and retries failed steps
  - rationale: Durable Standard workflow state survives failures and supports long waits
  - satisfies: R2, R3, R6, R9, R11
- **Automated checks** [n-checks] - service: AWS Lambda
  - in container: Primary Region
  - purpose: Validates claim fields and document types and flags claims for review
  - rationale: Runs without human input and is idempotent per claim version
  - satisfies: R2, R11
- **Decision notifier** [n-notify] - service: AWS Lambda
  - in container: Primary Region
  - purpose: Sends the decision email and the escalation or lapse notice
  - rationale: Invoked by the workflow with retries so each email is sent once per decision
  - satisfies: R4, R6, R9
- **Amazon SES** [n-ses] - service: Amazon SES
  - in container: Primary Region
  - purpose: Delivers decision emails
  - rationale: Managed email sending
  - satisfies: R4
- **Audit writer** [n-audit-fn] - service: AWS Lambda
  - in container: Primary Region
  - purpose: Writes each claim change as a hash-chained audit record
  - rationale: Triggered by the table stream after commit so no change is missed
  - satisfies: R5, R10
- **Audit store** [n-audit] - service: Amazon S3
  - in container: Primary Region
  - purpose: Retains tamper-evident audit records for later review
  - rationale: Versioned and KMS encrypted; Object Lock assumed for tamper evidence
  - configuration backup: versioning
  - configuration encryption: KMS
  - satisfies: R5, R10, C-data-retention
- **Audit failure queue** [n-audit-dlq] - service: Amazon SQS
  - in container: Primary Region
  - purpose: Holds audit records that could not be written
  - rationale: Failure destination so no audit record is silently dropped
  - configuration encryption: KMS
  - satisfies: R5, R10, I3
- **CloudTrail** [n-trail] - service: AWS CloudTrail
  - in container: Primary Region
  - purpose: Records API activity on the claim system
  - rationale: Shows who accessed or changed claims and documents
  - satisfies: R5, R10
- **KMS key** [n-kms] - service: AWS KMS
  - in container: Primary Region
  - purpose: Customer managed key for data at rest
  - rationale: Encrypts documents, claims table, audit store and queues
  - satisfies: I1, R10
- **CloudWatch** [n-cw] - service: Amazon CloudWatch
  - in container: Primary Region
  - purpose: Logs, metrics and alarms, including dead-letter queue depth
  - rationale: Observability for stuck or failed claims and audit gaps
  - satisfies: R6, I3

**Edges**

- Customer -> CloudFront (invoke, HTTPS): Loads web form
  - satisfies: R1
- CloudFront -> Web app bucket (origin): Fetches front end
  - configuration originAccess: OAC
  - satisfies: R1, R8
- Adjuster -> CloudFront (invoke, HTTPS): Loads adjuster UI
  - satisfies: R8
- Customer -> REST API (invoke, HTTPS): Submits claim
  - satisfies: R1, R7
- Adjuster -> REST API (invoke, HTTPS): Reads claims and submits decisions
  - satisfies: R3, R8
- AWS WAF -> REST API (other): Filters requests
  - satisfies: R1, I2
- REST API -> Cognito user pools (invoke, HTTPS): Validates sign-in tokens
  - satisfies: C-auth-methods, I2
- REST API -> Claim API handler (invoke): Routes requests
  - satisfies: R1, R8
- Customer -> Claim documents bucket (write): Uploads photos and PDFs
  - configuration presignedUrl: 15 minutes
  - satisfies: R7
- Claim API handler -> Claims table (write): Creates and updates claim
  - satisfies: R1, R6, R11
- Claim API handler -> Claim workflow (invoke): Starts claim execution named by claim id
  - satisfies: R2, R6, R11
- Claim API handler -> Claim workflow (invoke): Returns adjuster decision to waiting claim
  - satisfies: R3, R6
- Claim workflow -> Automated checks (invoke): Runs automated checks
  - satisfies: R2
- Automated checks -> Claim documents bucket (read): Reads uploaded documents
  - satisfies: R2, R7
- Automated checks -> Claims table (write): Records check results
  - satisfies: R2, R5
- Claim workflow -> Decision notifier (invoke): Requests decision or escalation email
  - satisfies: R4, R9
- Decision notifier -> Amazon SES (invoke): Sends email
  - satisfies: R4
- Amazon SES -> Customer inbox (other): Delivers decision email
  - satisfies: R4
- Claims table -> Audit writer (event): Table stream change record
  - satisfies: R5, R10
- Audit writer -> Audit store (write): Writes audit record
  - satisfies: R5, R10
- Audit writer -> Audit failure queue (other): On-failure record
  - configuration failureDestination: SQS
  - satisfies: R5, R10
- CloudTrail -> Audit store (write): Stores API activity logs
  - satisfies: R5, R10
- Claim workflow -> CloudWatch (other): Logs and metrics
  - satisfies: R6, I3
- Audit failure queue -> CloudWatch (other): Queue depth alarm
  - satisfies: I3, R5

---

## Scenario: order-events

**User prompt**

> An online shop accepts orders through an API. After an order is placed, payment capture, inventory reservation and the confirmation email must happen independently, so a failure in one does not block the others. Failed steps must be retried and never silently lost. Orders are looked up by order ID.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Accept orders through an API
- R2 [functional, confirmed] After an order is placed, payment capture, inventory reservation and confirmation email must happen independently
- R3 [non-functional, confirmed] A failure in one post-order step must not block the other steps
- R4 [functional, confirmed] Failed steps must be retried
- R5 [non-functional, confirmed] Failed steps must never be silently lost
- R6 [functional, confirmed] Orders can be looked up by order ID
- R7 [non-functional, inferred] Order steps should be decoupled so each runs independently of the others
- R8 [non-functional, inferred] Exhausted retries should be captured for inspection and reprocessing
- I1 [non-functional, inferred] Consumers must be idempotent so retried deliveries do not capture payment or reserve inventory twice
- I2 [non-functional, inferred] Alarm on dead-letter queue depth so exhausted retries are noticed and handled
- I3 [constraint, inferred] Order API must be protected from abuse and public exposure

**Containers** (tree)

- AWS Cloud (AWS Cloud) [c-aws]
  - Region (Region) [c-region]

**Nodes**

- **Customer Client** [n-client] - EXTERNAL third-party: Customer Client
  - purpose: Places orders through the API
  - rationale: Source of order requests
  - configuration authorizer: to be confirmed
  - satisfies: R1
- **AWS WAF** [n-waf] - service: AWS WAF
  - purpose: Filters malicious traffic to the order API
  - rationale: Public entry point needs web protection; REST APIs support WAF
  - satisfies: I3, R1
- **Order API** [n-api] - service: Amazon API Gateway
  - purpose: Accepts orders and returns once accepted
  - rationale: Managed REST API for order intake; REST type supports WAF
  - configuration apiType: REST
  - configuration authorizer: IAM
  - satisfies: R1, R6
- **Order Handler** [n-order-fn] - service: AWS Lambda
  - purpose: Validates the order, stores it and returns its order ID
  - rationale: Serverless handler; no server to manage
  - satisfies: R1, R6, R2
- **Orders Table** [n-orders] - service: Amazon DynamoDB
  - purpose: Stores orders keyed by order ID and emits change events
  - rationale: Key lookup by order ID; streams provide transactional outbox
  - configuration backup: PITR
  - configuration encryption: AWS-managed
  - satisfies: R6, R5, R2
- **Order Event Publisher** [n-stream-fn] - service: AWS Lambda
  - purpose: Reads order stream and publishes order-placed events to SNS
  - rationale: Publishes from committed writes so events are not lost
  - configuration failureDestination: SQS
  - satisfies: R2, R5, R7
- **Order Events Topic** [n-topic] - service: Amazon SNS
  - purpose: Fans out order-placed events to independent step queues
  - rationale: Decouples each step from the others
  - configuration encryption: AWS-managed
  - satisfies: R2, R3, R7
- **Payment Queue** [n-pay-q] - service: Amazon SQS
  - purpose: Buffers payment capture requests
  - rationale: Independent retry for payment capture
  - configuration deadLetterQueue: Payment DLQ
  - configuration encryption: AWS-managed
  - satisfies: R3, R4, R7
- **Inventory Queue** [n-inv-q] - service: Amazon SQS
  - purpose: Buffers inventory reservation requests
  - rationale: Independent retry for inventory reservation
  - configuration deadLetterQueue: Inventory DLQ
  - configuration encryption: AWS-managed
  - satisfies: R3, R4, R7
- **Email Queue** [n-mail-q] - service: Amazon SQS
  - purpose: Buffers confirmation email requests
  - rationale: Independent retry for confirmation email
  - configuration deadLetterQueue: Email DLQ
  - configuration encryption: AWS-managed
  - satisfies: R3, R4, R7
- **Payment Capture** [n-pay-fn] - service: AWS Lambda
  - purpose: Captures payment for the order
  - rationale: Serverless consumer, idempotent by order ID
  - satisfies: R2, R3, R4, I1
- **Inventory Reservation** [n-inv-fn] - service: AWS Lambda
  - purpose: Reserves inventory for the order
  - rationale: Serverless consumer, idempotent by order ID
  - satisfies: R2, R3, R4, I1
- **Confirmation Email Sender** [n-mail-fn] - service: AWS Lambda
  - purpose: Sends the order confirmation email
  - rationale: Serverless consumer, idempotent by order ID
  - satisfies: R2, R3, R4, I1
- **Amazon SES** [n-ses] - service: Amazon SES
  - purpose: Sends confirmation emails
  - rationale: Managed email sending service
  - satisfies: R2
- **Payment DLQ** [n-pay-dlq] - service: Amazon SQS
  - purpose: Holds payment messages that exhausted retries for inspection and redrive
  - rationale: Captures exhausted retries without silent loss
  - configuration encryption: AWS-managed
  - satisfies: R5, R8
- **Inventory DLQ** [n-inv-dlq] - service: Amazon SQS
  - purpose: Holds inventory messages that exhausted retries for inspection and redrive
  - rationale: Captures exhausted retries without silent loss
  - configuration encryption: AWS-managed
  - satisfies: R5, R8
- **Email DLQ** [n-mail-dlq] - service: Amazon SQS
  - purpose: Holds email messages that exhausted retries for inspection and redrive
  - rationale: Captures exhausted retries without silent loss
  - configuration encryption: AWS-managed
  - satisfies: R5, R8
- **CloudWatch** [n-cw] - service: Amazon CloudWatch
  - purpose: Logs, metrics and alarms, including DLQ depth alarms
  - rationale: Observability and alerting on failed steps
  - satisfies: I2, R5

**Edges**

- Customer Client -> AWS WAF (invoke, HTTPS): Places order
  - satisfies: R1
- AWS WAF -> Order API (invoke, HTTPS): Filtered request
  - satisfies: R1
- Order API -> Order Handler (invoke, HTTPS): Order request
  - satisfies: R1
- Order Handler -> Orders Table (write, HTTPS): Store order
  - satisfies: R6, R2
- Orders Table -> Order Event Publisher (event): Order change stream
  - satisfies: R2, R5
- Order Event Publisher -> Order Events Topic (event, HTTPS): Publish order placed
  - satisfies: R2, R7
- Order Events Topic -> Payment Queue (event): Fan out
  - satisfies: R3, R7
- Order Events Topic -> Inventory Queue (event): Fan out
  - satisfies: R3, R7
- Order Events Topic -> Email Queue (event): Fan out
  - satisfies: R3, R7
- Payment Queue -> Payment Capture (event): Payment message
  - configuration deadLetterQueue: Payment DLQ
  - satisfies: R4, R3
- Inventory Queue -> Inventory Reservation (event): Inventory message
  - configuration deadLetterQueue: Inventory DLQ
  - satisfies: R4, R3
- Email Queue -> Confirmation Email Sender (event): Email message
  - configuration deadLetterQueue: Email DLQ
  - satisfies: R4, R3
- Confirmation Email Sender -> Amazon SES (invoke, HTTPS): Send email
  - satisfies: R2
- Payment Queue -> Payment DLQ (other): Redrive after max receives
  - satisfies: R5, R8
- Inventory Queue -> Inventory DLQ (other): Redrive after max receives
  - satisfies: R5, R8
- Email Queue -> Email DLQ (other): Redrive after max receives
  - satisfies: R5, R8
- Order API -> CloudWatch (other): Metrics and logs
  - satisfies: I2

### Design B

**Requirements**

- R1 [functional, confirmed] Accept orders through an API
- R2 [functional, confirmed] After an order is placed, payment capture, inventory reservation and confirmation email must happen independently
- R3 [non-functional, confirmed] A failure in one post-order step must not block the other steps
- R4 [non-functional, confirmed] Failed steps must be retried
- R5 [non-functional, confirmed] Failed steps must never be silently lost
- R6 [functional, confirmed] Orders can be looked up by order ID
- R7 [non-functional, inferred] Post-order steps should be decoupled so each can fail and recover independently
- R8 [non-functional, inferred] Retried or exhausted failures should be recoverable for inspection and reprocessing
- R9 [functional, inferred] Order placement should return an order ID that can be used for lookup
- I1 [non-functional, inferred] Consumers must be idempotent so retries do not cause duplicate charges, reservations or emails
- I2 [non-functional, inferred] Alarm on dead-letter queue depth so exhausted failures are noticed and acted upon
- I3 [non-functional, inferred] Orders API must authenticate callers
- I4 [non-functional, inferred] Order data must be encrypted at rest and backed up

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Region (Region) [region]

**Nodes**

- **Shop client** [client] - EXTERNAL client-app: Shop client app
  - purpose: Places orders and looks up order status
  - rationale: Caller of the orders API
  - satisfies: R1, R6, R9
- **Cognito user pool** [cognito] - service: Amazon Cognito
  - in container: Region
  - purpose: Authenticates shoppers
  - rationale: Protects the public API with an authorizer
  - satisfies: I3
- **WAF** [waf] - service: AWS WAF
  - in container: Region
  - purpose: Filters malicious requests
  - rationale: Public entry point hardening; works with REST API
  - satisfies: R1, I3
- **Orders API** [api] - service: Amazon API Gateway
  - in container: Region
  - purpose: Accepts orders and serves lookups
  - rationale: Managed REST API for order placement and lookup by ID
  - configuration apiType: REST
  - configuration authorizer: Cognito user pool
  - satisfies: R1, R6, R9, I3
- **Order API handler** [orderFn] - service: AWS Lambda
  - in container: Region
  - purpose: Validates and stores orders, generates the order ID, returns it, and serves lookups by ID
  - rationale: Serverless handler for synchronous API calls
  - satisfies: R1, R6, R9
- **Orders table** [orders] - service: Amazon DynamoDB
  - in container: Region
  - purpose: Stores orders and per-step status keyed by orderId; streams changes
  - rationale: Key-value lookup by order ID; Streams act as outbox so events are not lost
  - configuration backup: PITR
  - configuration encryption: KMS
  - satisfies: R6, R9, R5, I4
- **KMS key** [kms] - service: AWS KMS
  - in container: Region
  - purpose: Customer managed key for data encryption
  - rationale: Encrypts table and queues
  - satisfies: I4
- **Stream publisher** [publisher] - service: AWS Lambda
  - in container: Region
  - purpose: Reads the DynamoDB stream and publishes order-placed events to SNS
  - rationale: Publishes only committed writes so events are not lost
  - satisfies: R2, R5, R7
- **Order events topic** [topic] - service: Amazon SNS
  - in container: Region
  - purpose: Fans out order-placed events to each step queue
  - rationale: Decouples steps so each is independent
  - configuration encryption: KMS
  - satisfies: R2, R3, R7
- **Payment queue** [payQ] - service: Amazon SQS
  - in container: Region
  - purpose: Buffers payment capture work with retries
  - rationale: Own queue isolates failures and enables retry
  - configuration encryption: KMS
  - satisfies: R2, R3, R4, R7
- **Inventory queue** [invQ] - service: Amazon SQS
  - in container: Region
  - purpose: Buffers inventory reservation work with retries
  - rationale: Own queue isolates failures and enables retry
  - configuration encryption: KMS
  - satisfies: R2, R3, R4, R7
- **Email queue** [mailQ] - service: Amazon SQS
  - in container: Region
  - purpose: Buffers confirmation email work with retries
  - rationale: Own queue isolates failures and enables retry
  - configuration encryption: KMS
  - satisfies: R2, R3, R4, R7
- **Payment DLQ** [payDlq] - service: Amazon SQS
  - in container: Region
  - purpose: Holds exhausted payment messages for inspection and redrive
  - rationale: Failures never silently lost
  - configuration encryption: KMS
  - satisfies: R5, R8
- **Inventory DLQ** [invDlq] - service: Amazon SQS
  - in container: Region
  - purpose: Holds exhausted inventory messages for inspection and redrive
  - rationale: Failures never silently lost
  - configuration encryption: KMS
  - satisfies: R5, R8
- **Email DLQ** [mailDlq] - service: Amazon SQS
  - in container: Region
  - purpose: Holds exhausted email messages for inspection and redrive
  - rationale: Failures never silently lost
  - configuration encryption: KMS
  - satisfies: R5, R8
- **Payment capture** [payFn] - service: AWS Lambda
  - in container: Region
  - purpose: Captures payment idempotently and updates order status
  - rationale: Independent consumer using idempotency key
  - satisfies: R2, R3, R4, I1
- **Inventory reservation** [invFn] - service: AWS Lambda
  - in container: Region
  - purpose: Reserves stock idempotently and updates order status
  - rationale: Independent consumer using idempotency key
  - satisfies: R2, R3, R4, I1
- **Confirmation email** [mailFn] - service: AWS Lambda
  - in container: Region
  - purpose: Sends confirmation idempotently and updates order status
  - rationale: Independent consumer using idempotency key
  - satisfies: R2, R3, R4, I1
- **Payment provider** [payApi] - EXTERNAL third-party: Payment provider
  - purpose: Captures card payments
  - rationale: Separate payment integration
  - satisfies: R2
- **Inventory system** [invApi] - EXTERNAL third-party: Inventory system
  - purpose: Reserves stock
  - rationale: Separate inventory service
  - satisfies: R2
- **SES** [ses] - service: Amazon SES
  - in container: Region
  - purpose: Sends confirmation emails
  - rationale: Managed email sending
  - satisfies: R2
- **CloudWatch** [cw] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Logs, metrics and alarms on DLQ depth
  - rationale: Makes exhausted failures visible
  - satisfies: R5, R8, I2

**Edges**

- Shop client -> WAF (invoke, HTTPS): Place/look up order
  - satisfies: R1, R6, R9
- WAF -> Orders API (invoke): Filtered requests
  - satisfies: R1, I3
- Orders API -> Cognito user pool (other): Authorize token
  - satisfies: I3
- Orders API -> Order API handler (invoke): Proxy request
  - satisfies: R1, R6, R9
- Order API handler -> Orders table (write): Put order / get by orderId
  - satisfies: R6, R9
- Orders table -> Stream publisher (event): DynamoDB Stream
  - satisfies: R2, R5
- Stream publisher -> Order events topic (write): Publish order placed
  - satisfies: R2, R7
- Order events topic -> Payment queue (event): Fan-out
  - satisfies: R2, R3, R7
- Order events topic -> Inventory queue (event): Fan-out
  - satisfies: R2, R3, R7
- Order events topic -> Email queue (event): Fan-out
  - satisfies: R2, R3, R7
- Payment queue -> Payment capture (event): Poll with partial batch response
  - configuration deadLetterQueue: Payment DLQ
  - satisfies: R4, R5, I1
- Inventory queue -> Inventory reservation (event): Poll with partial batch response
  - configuration deadLetterQueue: Inventory DLQ
  - satisfies: R4, R5, I1
- Email queue -> Confirmation email (event): Poll with partial batch response
  - configuration deadLetterQueue: Email DLQ
  - satisfies: R4, R5, I1
- Payment queue -> Payment DLQ (other): Redrive after max receives
  - satisfies: R5, R8
- Inventory queue -> Inventory DLQ (other): Redrive after max receives
  - satisfies: R5, R8
- Email queue -> Email DLQ (other): Redrive after max receives
  - satisfies: R5, R8
- Payment capture -> Payment provider (invoke, HTTPS): Capture payment
  - satisfies: R2
- Inventory reservation -> Inventory system (invoke, HTTPS): Reserve stock
  - satisfies: R2
- Confirmation email -> SES (invoke): Send email
  - satisfies: R2
- Payment capture -> Orders table (write): Update status and idempotency key
  - satisfies: R6, I1
- Inventory reservation -> Orders table (write): Update status and idempotency key
  - satisfies: R6, I1
- Confirmation email -> Orders table (write): Update status and idempotency key
  - satisfies: R6, I1
- Payment DLQ -> CloudWatch (other): Queue depth alarm
  - satisfies: I2, R8
- Inventory DLQ -> CloudWatch (other): Queue depth alarm
  - satisfies: I2, R8
- Email DLQ -> CloudWatch (other): Queue depth alarm
  - satisfies: I2, R8
- KMS key -> Orders table (other): Encrypts data
  - satisfies: I4

---

## Scenario: k8s-microservices

**User prompt**

> Our team already operates 12 microservices on Kubernetes with Helm charts and wants to move them to AWS with minimal change to tooling. Services share a MySQL database and a Redis cache. We need centralized logs, metrics and distributed tracing, and an HTTPS entry point for the public web frontend.

**Enabled priorities** (chosen by the user with one-click toggles)

- (none)

**Clarification answers given**

The tool asked the user up to three clarifying questions (listed among the requirements of each design, ids starting with C-). The user answered "You decide" to every question, so the architect chose.

### Design A

**Requirements**

- R1 [functional, confirmed] Operate 12 existing microservices on Kubernetes on AWS
- R2 [constraint, confirmed] Keep existing Helm charts and tooling with minimal change
- R3 [functional, confirmed] Services share a MySQL database
- R4 [functional, confirmed] Services share a Redis cache
- R5 [functional, confirmed] Centralized logs
- R6 [functional, confirmed] Centralized metrics
- R7 [functional, confirmed] Distributed tracing
- R8 [functional, confirmed] HTTPS entry point for the public web frontend
- R9 [constraint, inferred] Public web frontend is internet-facing
- R10 [non-functional, inferred] Encrypt data in transit between clients and the entry point
- R11 [non-functional, inferred] Operational observability for all 12 services without per-service rework
- C-user-scale [functional, inferred] What is the expected number of concurrent and total users for the public frontend? (decided by the architect)
- C-availability-target [functional, inferred] What availability target should the application meet? (decided by the architect)
- C-data-retention [functional, inferred] How long should logs and traces be retained? (decided by the architect)
- I1 [non-functional, inferred] Run the workload across at least two Availability Zones for high availability (target roughly 99.9%)
- I2 [functional, inferred] Store MySQL credentials and the Redis endpoint securely and make them available to pods
- I3 [functional, inferred] Provision a TLS certificate for the public HTTPS listener
- I4 [non-functional, inferred] Encrypt data at rest for the database and cache, and back up the database
- I5 [functional, inferred] Pods need outbound access to pull images and send telemetry to AWS APIs
- I6 [non-functional, inferred] Protect the public entry point from common web exploits

**Containers** (tree)

- AWS Cloud (AWS Cloud) [cloud]
  - Region (Region) [region]
    - Application VPC (VPC) [vpc]
      - Availability Zone A (Availability Zone) [az1]
        - Public subnet A (Subnet, public) [pub1]
        - Private subnet A (Subnet, private) [priv1]
      - Availability Zone B (Availability Zone) [az2]
        - Public subnet B (Subnet, public) [pub2]
        - Private subnet B (Subnet, private) [priv2]

**Nodes**

- **Internet users** [users] - EXTERNAL user: Internet users
  - purpose: Browse the public web frontend
  - rationale: Clients of the public frontend
  - satisfies: R8, R9
- **Route 53** [dns] - service: Amazon Route 53
  - in container: AWS Cloud
  - purpose: DNS for the frontend domain
  - rationale: Resolves the public hostname to the ALB
  - satisfies: R8, R9
- **ACM certificate** [acm] - service: AWS Certificate Manager
  - in container: Region
  - purpose: TLS certificate for the HTTPS listener
  - rationale: Provides managed, auto-renewing certificates for the ALB
  - satisfies: R8, R10, I3
- **AWS WAF** [waf] - service: AWS WAF
  - in container: Region
  - purpose: Filter malicious web requests
  - rationale: Protects the internet-facing ALB; WAF can be associated with an ALB
  - satisfies: I6, R9
- **Application Load Balancer** [alb] - service: Application Load Balancer
  - in container: Public subnet A
  - purpose: HTTPS entry point routing to the frontend service
  - rationale: Terminates TLS and routes to pods through the Kubernetes Ingress; spans two AZs
  - satisfies: R8, R9, R10, I1
- **NAT Gateway** [nat] - service: NAT Gateway
  - in container: Public subnet B
  - purpose: Outbound internet access for private subnets
  - rationale: Lets pods pull images and reach AWS APIs and external endpoints
  - satisfies: I5
- **Amazon EKS cluster** [eks] - service: Amazon EKS
  - in container: Region
  - purpose: Run the 12 microservices with Helm
  - rationale: Managed Kubernetes keeps Helm charts and kubectl tooling with minimal change
  - satisfies: R1, R2, R11, I1
- **Fargate pods (12 microservices)** [pods] - service: AWS Fargate
  - in container: Private subnet A
  - purpose: Run the microservice pods without managing nodes
  - rationale: Serverless compute for pods in private subnets across two AZs
  - satisfies: R1, R2, I1
- **RDS for MySQL** [rds] - service: Amazon RDS
  - in container: Private subnet B
  - purpose: Shared MySQL database
  - rationale: Managed MySQL compatible with existing services; Multi-AZ with backups
  - configuration multiAz: True
  - configuration backup: automated backups
  - configuration encryption: KMS
  - satisfies: R3, I1, I4
- **ElastiCache for Redis** [redis] - service: Amazon ElastiCache
  - in container: Private subnet A
  - purpose: Shared Redis cache
  - rationale: Managed Redis OSS compatible with existing clients; replica in the second AZ
  - configuration multiAz: True
  - configuration backup: snapshots
  - configuration encryption: KMS
  - satisfies: R4, I1, I4
- **KMS key** [kms] - service: AWS KMS
  - in container: Region
  - purpose: Customer managed key for data at rest
  - rationale: Encrypts database and cache storage
  - satisfies: I4
- **Secrets Manager** [secrets] - service: AWS Secrets Manager
  - in container: Region
  - purpose: Hold MySQL credentials
  - rationale: Pods fetch credentials via IAM roles for service accounts instead of storing them in charts
  - satisfies: I2, R3
- **CloudWatch Logs and Container Insights** [cw] - service: Amazon CloudWatch
  - in container: Region
  - purpose: Centralized logs, metrics and alarms
  - rationale: Single place for logs and metrics of all pods, collected cluster-wide without per-service changes
  - satisfies: R5, R6, R11
- **AWS X-Ray** [xray] - service: AWS X-Ray
  - in container: Region
  - purpose: Distributed tracing
  - rationale: Receives traces from the OpenTelemetry collector for end-to-end service maps
  - satisfies: R7, R11

**Edges**

- Internet users -> Route 53 (other, DNS): Resolve domain
  - satisfies: R8, R9
- Internet users -> Application Load Balancer (invoke, HTTPS): HTTPS requests
  - satisfies: R8, R9, R10
- AWS WAF -> Application Load Balancer (other): Protects ALB
  - satisfies: I6
- ACM certificate -> Application Load Balancer (other): TLS certificate
  - satisfies: R10, I3
- Application Load Balancer -> Fargate pods (12 microservices) (invoke, HTTP): Route to frontend pods
  - satisfies: R8, R1
- Amazon EKS cluster -> Fargate pods (12 microservices) (other): Schedules pods
  - satisfies: R1, R2
- Fargate pods (12 microservices) -> RDS for MySQL (write, MySQL): SQL queries
  - satisfies: R3
- Fargate pods (12 microservices) -> ElastiCache for Redis (write, Redis): Cache reads/writes
  - satisfies: R4
- Fargate pods (12 microservices) -> Secrets Manager (read, HTTPS): Fetch DB credentials
  - satisfies: I2
- Fargate pods (12 microservices) -> NAT Gateway (other, HTTPS): Outbound traffic
  - satisfies: I5
- Fargate pods (12 microservices) -> CloudWatch Logs and Container Insights (write, HTTPS): Logs and metrics
  - satisfies: R5, R6, R11
- Fargate pods (12 microservices) -> AWS X-Ray (write, HTTPS): Traces
  - satisfies: R7, R11
- KMS key -> RDS for MySQL (other): Encryption key
  - satisfies: I4
- KMS key -> ElastiCache for Redis (other): Encryption key
  - satisfies: I4
- Route 53 -> Application Load Balancer (other): Alias record
  - satisfies: R8

### Design B

**Requirements**

- R1 [functional, confirmed] Move 12 existing microservices running on Kubernetes to AWS
- R2 [constraint, confirmed] Keep existing Kubernetes and Helm chart tooling with minimal change
- R3 [functional, confirmed] Services share a MySQL database
- R4 [functional, confirmed] Services share a Redis cache
- R5 [functional, confirmed] Centralized logging across all services
- R6 [functional, confirmed] Centralized metrics across all services
- R7 [functional, confirmed] Distributed tracing across all services
- R8 [functional, confirmed] HTTPS entry point for the public web frontend
- R9 [non-functional, inferred] Manage TLS certificates for the public HTTPS endpoint
- R10 [non-functional, inferred] Shared MySQL and Redis data stores must be reachable from all services with consistent access
- C-user-scale [functional, inferred] What is the expected peak concurrent user count and request rate for the public frontend? (decided by the architect)
- C-availability-target [functional, inferred] What availability target applies to the public frontend and shared data stores? (decided by the architect)
- C-data-retention [functional, inferred] How long should logs, metrics, and traces be retained? (decided by the architect)
- I1 [non-functional, inferred] Public entry point, EKS worker nodes, NAT gateways and shared data stores must survive a single Availability Zone failure, meeting the 99.95% availability target
- I2 [non-functional, inferred] Public HTTPS frontend must be protected from common web attacks such as SQL injection and bot traffic
- I3 [non-functional, inferred] Shared MySQL and Redis data must be backed up with point-in-time recovery

**Containers** (tree)

- AWS Cloud (AWS Cloud) [aws]
  - AWS Region (Region) [region]
    - VPC (VPC) [vpc]
      - Availability Zone A (Availability Zone) [az-a]
        - Public subnet A (Subnet, public) [pub-a]
        - Private subnet A (Subnet, private) [priv-a]
      - Availability Zone B (Availability Zone) [az-b]
        - Public subnet B (Subnet, public) [pub-b]
        - Private subnet B (Subnet, private) [priv-b]

**Nodes**

- **Web users** [users] - EXTERNAL user: Web users
  - purpose: Access the public web frontend over HTTPS
  - rationale: Source of all public traffic to the frontend
  - satisfies: R8
- **Amazon Route 53** [route53] - service: Amazon Route 53
  - in container: AWS Cloud
  - purpose: DNS for the public HTTPS endpoint
  - rationale: Maps the frontend domain to the load balancers with alias records
  - satisfies: R8
- **AWS Certificate Manager** [acm] - service: AWS Certificate Manager
  - in container: AWS Region
  - purpose: Issues and renews the public TLS certificate
  - rationale: Managed certificates renew automatically and attach directly to the ALBs
  - satisfies: R9
- **AWS WAF** [waf] - service: AWS WAF
  - in container: AWS Region
  - purpose: Filters malicious web requests before they reach the frontend
  - rationale: Protects the public entry point with managed rule sets; AWS WAF attaches to the ALBs
  - satisfies: R8, I2
- **Application Load Balancer (AZ A)** [alb] - service: Application Load Balancer
  - in container: Public subnet A
  - purpose: Terminates HTTPS and routes requests to the frontend service pods
  - rationale: Provides the HTTPS entry point with the ACM certificate and spreads traffic across Availability Zones for the expected peak load
  - satisfies: R1, R8, R9, I1
- **Application Load Balancer (AZ B)** [alb-b] - service: Application Load Balancer
  - in container: Public subnet B
  - purpose: Terminates HTTPS and routes requests to the frontend service pods in the second Availability Zone
  - rationale: Second load balancer node in a second Availability Zone so the entry point survives a single Availability Zone failure
  - satisfies: R1, R8, R9, I1
- **NAT Gateway A** [nat-a] - service: NAT Gateway
  - in container: Public subnet A
  - purpose: Outbound internet access for private subnet A
  - rationale: Lets worker nodes pull images and reach external APIs without public IPs
  - satisfies: R1, I1
- **NAT Gateway B** [nat-b] - service: NAT Gateway
  - in container: Public subnet B
  - purpose: Outbound internet access for private subnet B
  - rationale: Removes the single point of failure for outbound traffic
  - satisfies: R1, I1
- **Amazon EKS cluster** [eks] - service: Amazon EKS
  - in container: AWS Region
  - purpose: Runs the 12 existing microservices using the current Kubernetes manifests and Helm charts
  - rationale: Managed control plane keeps the existing Kubernetes and Helm tooling with minimal change
  - satisfies: R1, R2, C-user-scale
- **EKS managed node group (EC2)** [eks-nodes] - service: Amazon EC2
  - in container: Private subnet A
  - purpose: Hosts the microservice pods across private subnets
  - rationale: EC2 worker nodes let the existing workloads run without re-platforming; the node group spans both private subnets
  - satisfies: R1, R2, C-user-scale, I1
- **Shared MySQL (Amazon RDS for MySQL)** [rds-mysql] - service: Amazon RDS
  - in container: Private subnet A
  - purpose: Shared relational database used by all services
  - rationale: Managed MySQL keeps the existing schema and drivers; Multi-AZ standby meets the availability target
  - configuration backup: automated backups with point-in-time restore
  - configuration multiAz: Multi-AZ standby
  - configuration encryption: AWS-managed
  - satisfies: R3, R10, C-availability-target, I1, I3
- **Shared Redis cache (Amazon ElastiCache)** [redis] - service: Amazon ElastiCache
  - in container: Private subnet B
  - purpose: Shared cache reachable by all services
  - rationale: Managed Redis-compatible cache with replicas gives all services the same cache endpoint
  - configuration backup: snapshots
  - configuration multiAz: Multi-AZ replicas
  - configuration encryption: AWS-managed
  - satisfies: R4, R10, C-availability-target, I1, I3
- **Amazon CloudWatch** [cloudwatch] - service: Amazon CloudWatch
  - in container: AWS Region
  - purpose: Central logs and metrics for all services and the cluster
  - rationale: Container Insights and CloudWatch Logs collect logs and metrics from all pods in one place
  - satisfies: R5, R6, C-data-retention
- **AWS X-Ray** [xray] - service: AWS X-Ray
  - in container: AWS Region
  - purpose: Distributed tracing across all services
  - rationale: Stores and visualises request traces that span the microservices
  - satisfies: R7, C-data-retention

**Edges**

- Web users -> Amazon Route 53 (invoke, DNS): Resolve frontend domain
  - satisfies: R8
- Web users -> Application Load Balancer (AZ A) (invoke, HTTPS): HTTPS requests
  - satisfies: R8, R9
- Amazon Route 53 -> Application Load Balancer (AZ A) (other): Alias record to load balancer (AZ A)
  - satisfies: R8
- AWS WAF -> Application Load Balancer (AZ A) (other): Web ACL association
  - satisfies: R8, I2
- AWS Certificate Manager -> Application Load Balancer (AZ A) (other): TLS certificate
  - satisfies: R9
- Application Load Balancer (AZ A) -> EKS managed node group (EC2) (invoke, HTTP): Forward to frontend pods
  - satisfies: R1, R2, C-user-scale
- EKS managed node group (EC2) -> Shared MySQL (Amazon RDS for MySQL) (read, MySQL): Shared MySQL access
  - satisfies: R3, R10
- EKS managed node group (EC2) -> Shared Redis cache (Amazon ElastiCache) (read, Redis): Shared cache access
  - satisfies: R4, R10
- EKS managed node group (EC2) -> Amazon CloudWatch (write, HTTPS): Logs and metrics
  - satisfies: R5, R6
- EKS managed node group (EC2) -> AWS X-Ray (write, HTTPS): Trace segments
  - satisfies: R7
- Amazon Route 53 -> Application Load Balancer (AZ B) (other): Alias record to load balancer (AZ B)
  - satisfies: R8, I1
- AWS WAF -> Application Load Balancer (AZ B) (other): Web ACL association (AZ B)
  - satisfies: R8, I2
- AWS Certificate Manager -> Application Load Balancer (AZ B) (other): TLS certificate (AZ B)
  - satisfies: R9
- Application Load Balancer (AZ B) -> EKS managed node group (EC2) (invoke, HTTP): Forward to frontend pods (AZ B)
  - satisfies: R1, R2, C-user-scale, I1
