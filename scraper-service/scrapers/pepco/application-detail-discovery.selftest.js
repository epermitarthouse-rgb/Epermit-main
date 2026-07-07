"use strict";

const {
  parseOverviewResponse,
  parseStatusChangesResponse,
  parseMessagesResponse,
  parseDocumentsResponse,
  parsePepcoGetSessionToken,
  isPlausiblePepcoBearerToken,
  findPepcoBearerTokenInValue,
  buildPepcoApiHeaders,
} = require("./application-detail-discovery.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const overviewBody = {
    isSuccess: true,
    value: {
      projectOverview: {
        projectName: "Wonder - Tenant Fit Out - Modification & Relocation - 001",
        propertyAddress: "10432 Campus Way S,Upper Marlboro,Maryland,20774",
        jobId: "PEPCO-NB-0064620",
        statusName: "Contract Sent",
        actionRequired: true,
      },
      projectSummary: {
        projectOwnerName: "PepcoMaryland",
        submitterName: "Philip Agar",
        opcoContactName: "Kwabena Adams",
        opcoContactEmail: "kkadams@pepco.com",
        expectedInServiceByDate: "2026-12-31T05:00:00+00:00",
      },
      projectDetails: {
        applicationDetails: {
          projectContacts: [{ contactType: "Owner", primaryContact: true }],
          billing: { constructionBillingAddress: "x" },
          projectInformation: { siteDetails: "y" },
          electricServiceLoads: { centralAC: 1, centralHeat: 2 },
        },
      },
      projectStatusTrackingDetails: {
        lastUpdatedDateTime: null,
        milestones: [{ name: "Engineering and Design" }],
      },
    },
  };

  const ov = parseOverviewResponse(overviewBody);
  assert(
    ov.overview &&
      /** @type {{ projectName?: string }} */ (ov.overview).projectName ===
        "Wonder - Tenant Fit Out - Modification & Relocation - 001",
    "projectName",
  );
  assert(
    /** @type {{ jobId?: string }} */ (ov.overview).jobId === "PEPCO-NB-0064620",
    "jobId",
  );
  assert(
    /** @type {{ statusName?: string }} */ (ov.overview).statusName === "Contract Sent",
    "statusName",
  );
  assert(
    /** @type {{ projectOwnerName?: string }} */ (ov.projectSummary).projectOwnerName === "PepcoMaryland",
    "projectOwnerName",
  );

  const statusBody = {
    isSuccess: true,
    value: [
      {
        milestoneName: "Engineering and Design",
        statusName: "Contract Sent",
        statusChangeDateTime: "2026-06-17T14:27:40.7344615+00:00",
      },
      {
        milestoneName: "Engineering and Design",
        statusName: "In Design",
        statusChangeDateTime: "2026-05-01T13:42:25.5409882+00:00",
      },
      {
        milestoneName: "Engineering and Design",
        statusName: "More Information Required",
        statusChangeDateTime: "2026-04-03T13:38:04.8987211+00:00",
      },
      {
        milestoneName: "Engineering and Design",
        statusName: "In Technical Review",
        statusChangeDateTime: "2026-03-05T16:08:07.7136939+00:00",
      },
      {
        milestoneName: "Initiation",
        statusName: "Submitted",
        statusChangeDateTime: "2026-03-03T14:53:38.6592192+00:00",
      },
    ],
  };

  const st = parseStatusChangesResponse(statusBody);
  assert(st.statusChanges.length === 5, "statusChanges length");
  assert(st.currentMilestone === "Engineering and Design", "currentMilestone");
  assert(st.currentStatus === "Contract Sent", "currentStatus");
  assert(
    st.statusLastUpdatedAt === "2026-06-17T14:27:40.7344615+00:00",
    "statusLastUpdatedAt",
  );

  const messagesBody = {
    isSuccess: true,
    value: {
      messageDetails: {
        messages: [
          {
            statusChangeDisplayName: "Submitted",
            senderMessage: "hello",
            isSPOC: false,
            isInternalUser: false,
            receiverName: "PEPCO",
            receiverMessage: null,
            messageDateTime: "2026-03-03T14:53:42.284+00:00",
          },
        ],
      },
    },
  };

  const msg = parseMessagesResponse(messagesBody);
  assert(msg.messageCount === 1, "messageCount");
  assert(msg.latestMessageAt === "2026-03-03T14:53:42.284+00:00", "latestMessageAt");

  const documentsBody = {
    isSuccess: true,
    value: {
      documents: [
        { documentName: "Wonder - Tenant Fit Out_Application.pdf", documentType: "Application" },
        {
          documentName:
            "Wonder - Largo, MD - MEP - Sheet - E301 - ELECTRICAL PANEL SCHEDULES.pdf",
          documentType: "Plan",
        },
        {
          documentName:
            "Wonder - Largo, MD - MEP - Sheet - E300 - ELECTRICAL ONE-LINE DIAGRAMS.pdf",
          documentType: "Plan",
        },
      ],
    },
  };

  const docs = parseDocumentsResponse(documentsBody);
  assert(docs.documentCount === 3, "documentCount");
  assert(
    docs.documents[0].documentName === "Wonder - Tenant Fit Out_Application.pdf",
    "first document",
  );

  assert(isPlausiblePepcoBearerToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig"), "jwt shape");
  assert(!isPlausiblePepcoBearerToken("not-a-token"), "reject non-jwt");
  const nested = findPepcoBearerTokenInValue(
    JSON.stringify({ access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig" }),
  );
  assert(nested != null, "nested access_token");

  const headers = buildPepcoApiHeaders({
    bearerToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig",
  });
  assert(typeof headers.authorization === "string" && headers.authorization.startsWith("Bearer "), "auth header");
  assert(headers["cache-control"] === "no-cache", "cache-control header");

  const sessionOk = parsePepcoGetSessionToken({
    username: "testuser",
    token: "opaque-session-token-value",
  });
  assert(sessionOk != null && sessionOk.token === "opaque-session-token-value", "GetSession opaque token");

  const sessionEncrypted = parsePepcoGetSessionToken({
    username: null,
    encryptedUsername: "enc-user-hash",
    token: "another-opaque-token",
  });
  assert(sessionEncrypted != null, "GetSession encryptedUsername path");

  assert(parsePepcoGetSessionToken({ username: "u", token: null }) === null, "reject null token");
  assert(parsePepcoGetSessionToken({ username: null, token: "t" }) === null, "reject missing username");

  console.log("pepco application-detail parsing selftest: OK");
}

run();
