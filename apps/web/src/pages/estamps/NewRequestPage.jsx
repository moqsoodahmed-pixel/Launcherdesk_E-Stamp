import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { createEStampRequestSchema } from "../../schemas/estampRequest.schema";
import { apiClient } from "../../api/client";
import { formatCurrency, errorMessage } from "../../utils/format";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";

// The Calculation step is deliberately absent: the duty is a server-computed
// figure the user cannot influence, so making them click "Calculate" was a
// dead step. It now runs automatically on reaching Review, and the result is
// presented as a price summary there.
const STEPS = ["Basic Details", "State & Article", "Financial Details", "Review & Submit"];
const REVIEW_STEP = STEPS.length - 1;

// Fields validated (via handleSubmit-style trigger) before each step can
// advance. Mirrors createEStampRequestSchema's exact field set - split
// across steps, nothing added or removed.
const STEP_FIELDS = [
  ["firstParty", "secondParty", "descriptionOfDocument", "propertyDescription"],
  ["stateCode", "articleId"],
  ["considerationPrice", "stampDutyPaidBy", "numberOfEStamps"],
  [],
];

// The exact set of input values a fetched calculation was computed from -
// if any of these change, the calculation is stale and must not be usable
// for submission until it is refreshed. This is the single most
// safety-critical piece of the wizard: it is what stops the frontend from
// ever submitting against a calculation that no longer matches the form.
function calcKey({ stateCode, articleId, considerationPrice, numberOfEStamps }) {
  return JSON.stringify([stateCode, articleId, considerationPrice, numberOfEStamps]);
}

export default function NewRequestPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // /wallet is only reachable with WALLET_VIEW (Super Admin); others are told who can add funds.
  const canOpenWallet = hasPermission(user, PERMISSIONS.WALLET_VIEW);
  const [step, setStep] = useState(0);
  const [lookupError, setLookupError] = useState(null);
  const [states, setStates] = useState([]);
  const [articles, setArticles] = useState([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  // Session-level cache of articles already fetched per state, so switching
  // back to a previously-selected state never re-requests the same data.
  const articlesCacheRef = useRef(new Map());
  const [balance, setBalance] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [calculation, setCalculation] = useState(null);
  const [calculatedForKey, setCalculatedForKey] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState(null);
  const [attemptedKey, setAttemptedKey] = useState(null);

  // WHICH party pays, tracked separately from their name. The submitted
  // field is a free-text name, and two parties can legitimately share one
  // (same name, different people) - so deciding the selected button by
  // comparing names marks BOTH of them selected and leaves the real choice
  // ambiguous. The side is the answer; the name is just what gets sent.
  const [paidBySide, setPaidBySide] = useState(null);

  // Generated once per visit and resent unchanged on every submit attempt
  // (including retries) - the backend recognizes this to avoid a duplicate
  // charge/request on accidental resubmission. Do not regenerate per step.
  const [idempotencyKey] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createEStampRequestSchema),
    mode: "onChange",
    defaultValues: { numberOfEStamps: 1 },
  });

  const values = watch();
  const selectedArticle = useMemo(() => articles.find((a) => a._id === values.articleId), [articles, values.articleId]);
  const currentKey = useMemo(() => calcKey(values), [values.stateCode, values.articleId, values.considerationPrice, values.numberOfEStamps]);
  const isFresh = calculation !== null && calculatedForKey === currentKey;

  useEffect(() => {
    // Available = balance minus amounts reserved by requests still in their window.
    apiClient
      .get("/wallet/balance")
      .then((res) => setBalance(res.data.data.availableBalance ?? res.data.data.balance))
      .catch(() => setBalance(null));
    // The full state/UT master list - always shows every supported
    // jurisdiction, independent of whether any article has been imported
    // for it yet (unlike /articles/states, which only returns states that
    // already have at least one article).
    apiClient
      .get("/states")
      .then((res) => setStates(res.data.data))
      .catch((err) => {
        setStates([]);
        setLookupError(errorMessage(err, "Could not load states. Refresh the page to try again."));
      });
  }, []);

  const fetchArticlesForState = (stCode, force = false) => {
    if (!stCode) {
      setArticles([]);
      return;
    }
    if (!force) {
      const cached = articlesCacheRef.current.get(stCode);
      if (cached && cached.length > 0) {
        setArticles(cached);
        return;
      }
    }
    setArticlesLoading(true);
    apiClient
      .get("/articles", { params: { stateCode: stCode } })
      .then((res) => {
        const payload = res.data.data;
        const items = Array.isArray(payload) ? payload : payload?.items || [];
        articlesCacheRef.current.set(stCode, items);
        setArticles(items);
      })
      .catch((err) => {
        setArticles([]);
        setLookupError(errorMessage(err, "Could not load articles for this state."));
      })
      .finally(() => setArticlesLoading(false));
  };

  useEffect(() => {
    fetchArticlesForState(values.stateCode);
  }, [values.stateCode]);

  async function goNext() {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const valid = await trigger(fields);
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // Runs the price preview once per distinct set of inputs as soon as the
  // user reaches Review. `attemptedKey` is what makes this safe: without it a
  // failed call would leave `isFresh` false forever and the effect would
  // retry in a tight loop. A failure is surfaced with an explicit Retry
  // instead.
  useEffect(() => {
    if (step !== REVIEW_STEP) return;
    if (!values.stateCode || !values.articleId) return;
    if (isFresh || calculating) return;
    if (attemptedKey === currentKey) return;
    setAttemptedKey(currentKey);
    runCalculation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, values.stateCode, values.articleId, currentKey, isFresh, calculating, attemptedKey]);

  function choosePayer(side) {
    setPaidBySide(side);
    setValue("stampDutyPaidBy", side === "FIRST" ? values.firstParty : values.secondParty, { shouldValidate: true });
  }

  // Keeps the name that actually gets submitted in step with the chosen
  // party if that party is later renamed, so the highlighted button and the
  // submitted payer can never disagree. If the chosen party is cleared
  // entirely, the selection goes with it rather than submitting someone who
  // is no longer a party to the document.
  useEffect(() => {
    if (!paidBySide) return;
    const name = paidBySide === "FIRST" ? values.firstParty : values.secondParty;
    if (!name) {
      setPaidBySide(null);
      setValue("stampDutyPaidBy", "", { shouldValidate: false });
      return;
    }
    if (name !== values.stampDutyPaidBy) {
      setValue("stampDutyPaidBy", name, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidBySide, values.firstParty, values.secondParty]);

  async function runCalculation() {
    setCalcError(null);
    setCalculating(true);
    try {
      const { data } = await apiClient.post("/estamps/calculate", {
        stateCode: values.stateCode,
        articleId: values.articleId,
        considerationPrice: values.considerationPrice || 0,
        numberOfEStamps: values.numberOfEStamps || 1,
      });
      setCalculation(data.data);
      setCalculatedForKey(calcKey(values));
    } catch (err) {
      setCalcError(errorMessage(err, "Unable to calculate stamp duty."));
      setCalculation(null);
      setCalculatedForKey(null);
    } finally {
      setCalculating(false);
    }
  }

  async function onSubmit(formValues) {
    setServerError(null);
    if (!isFresh) {
      setServerError("The price is still being worked out for the details you entered. Wait for the summary below, then submit.");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await apiClient.post("/estamps", { ...formValues, idempotencyKey });
      const { request } = data.data;
      navigate(`/estamps/requests/${request._id}`, {
        replace: true,
        state: { notice: `Request ${request.requestNumber} created. ${formatCurrency(request.calculatedStampDuty)} is reserved from your available balance and charged when the 20-minute window ends. Cancel within the window and nothing is charged.` },
      });
    } catch (err) {
      // A 403 here is very often a real, specific business reason (e.g.
      // "E-Stamp service is not enabled for your organization") rather than
      // a missing RBAC permission - errorMessage()'s blanket "You do not
      // have permission..." rewrite would hide that and make a
      // configuration problem look like an access-control bug. Submission
      // failures always show the backend's own message when it sent one.
      setServerError(err?.response?.data?.message || errorMessage(err, "Failed to create request"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl pb-24">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Create E-Stamp Request</h1>
        {balance !== null && (
          <div className="text-sm text-slate-500">
            Available balance: <span className="font-semibold text-slate-900">{formatCurrency(balance)}</span>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Need to create many at once?{" "}
        <Link to="/estamps/bulk" className="text-brand-600 hover:underline">
          Use Bulk E-Stamp
        </Link>
        .
      </p>

      <Stepper step={step} />

      {serverError && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 flex items-center justify-between">
          <span>{serverError}</span>
          <button type="button" onClick={() => setServerError(null)} className="text-red-500 hover:text-red-700 ml-2 font-bold" aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}
      {lookupError && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 flex items-center justify-between">
          <span>{lookupError}</span>
          <button type="button" onClick={() => setLookupError(null)} className="text-red-500 hover:text-red-700 ml-2 font-bold" aria-label="Dismiss lookup error">
            ✕
          </button>
        </div>
      )}
      {balance === 0 && !serverError && (
        <div className="mb-4 rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">
          Your organization's available balance is ₹0. This request will be rejected unless funds are added first. <AddFundsHint canOpenWallet={canOpenWallet} />
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First Party" error={errors.firstParty?.message} hint="Full legal name of the first party / executant / transferor">
                <input className="input" {...register("firstParty")} placeholder="e.g. John Doe / ABC Corp" maxLength={300} />
              </Field>
              <Field label="Second Party" error={errors.secondParty?.message} hint="Full legal name of the second party / claimant / transferee">
                <input className="input" {...register("secondParty")} placeholder="e.g. Jane Smith / XYZ Ltd" maxLength={300} />
              </Field>
            </div>
            {values.firstParty && values.secondParty && values.firstParty.trim().toLowerCase() === values.secondParty.trim().toLowerCase() && (
              <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2">
                <strong>Notice:</strong> First Party and Second Party names are identical ("{values.firstParty.trim()}"). Ensure this is intentional for self-declarations or unilateral affidavits.
              </div>
            )}
            <Field label="Description of Document" error={errors.descriptionOfDocument?.message} hint="Brief purpose (e.g. Rental Agreement, Power of Attorney, Affidavit)">
              <textarea className="input" rows={2} {...register("descriptionOfDocument")} maxLength={1000} placeholder="Purpose of this document..." />
            </Field>
            <Field label="Property Description" hint="Optional details: address, survey number, or asset identifiers">
              <textarea className="input" rows={2} {...register("propertyDescription")} maxLength={2000} placeholder="Optional property or asset description..." />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="State" error={errors.stateCode?.message}>
              <select
                className="input"
                value={values.stateCode || ""}
                onChange={(e) => {
                  setValue("stateCode", e.target.value, { shouldValidate: true });
                  setValue("articleId", "", { shouldValidate: false });
                }}
              >
                <option value="">Select state</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          <div className="block">
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="article-select" className="text-sm font-medium text-slate-700">
                {values.stateCode && articles.length > 0 ? `Article (${articles.length} available)` : "Article"}
              </label>
              {values.stateCode && (
                <button
                  type="button"
                  onClick={() => fetchArticlesForState(values.stateCode, true)}
                  disabled={articlesLoading}
                  className="text-xs text-brand-600 hover:underline font-normal"
                >
                  {articlesLoading ? "Loading..." : "↻ Refresh articles"}
                </button>
              )}
            </div>
            <select
              id="article-select"
              aria-label="Article"
              className="input"
              {...register("articleId")}
              disabled={!values.stateCode || articlesLoading}
            >
              <option value="">Select article</option>
              {articles.map((a, idx) => {
                const rule = a.calculationRule;
                const priceLabel = rule?.type === "FIXED" && rule.fixedAmount
                  ? `Fixed: ₹${rule.fixedAmount}`
                  : rule?.minAmount
                  ? `Min: ₹${rule.minAmount}`
                  : rule?.percentage
                  ? `${rule.percentage}%`
                  : null;
                return (
                  <option key={a._id} value={a._id}>
                    {idx + 1}. {a.articleCode} - {a.title} {priceLabel ? `(${priceLabel})` : ""}
                  </option>
                );
              })}
            </select>
            {errors.articleId?.message && <span className="block text-xs text-red-600 mt-1">{errors.articleId?.message}</span>}
            {values.stateCode && !articlesLoading && articles.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">
                No official articles have been imported for this state yet.
              </p>
            )}
            {selectedArticle && (
              <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between font-medium text-slate-800">
                  <span>Government Stamp Duty:</span>
                  <span className="text-brand-700 font-semibold text-sm">
                    {selectedArticle.calculationRule?.type === "FIXED" && selectedArticle.calculationRule?.fixedAmount
                      ? `₹${selectedArticle.calculationRule.fixedAmount} (Fixed)`
                      : selectedArticle.calculationRule?.minAmount
                      ? `₹${selectedArticle.calculationRule.minAmount} (Minimum statutory duty)`
                      : selectedArticle.calculationRule?.percentage
                      ? `${selectedArticle.calculationRule.percentage}% of Consideration`
                      : "Statutory Rate"}
                  </span>
                </div>
                {selectedArticle.description && (
                  <p className="text-slate-500 text-[11px] leading-relaxed">{selectedArticle.description}</p>
                )}
              </div>
            )}
          </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Dedicated Stamp Duty Breakdown & Compliance Section */}
            <div className="p-4 rounded-xl border border-brand-200 bg-brand-50/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-brand-800 uppercase tracking-wider">
                  Mandatory Government Stamp Duty
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Government Statutory Rate
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900">
                  {selectedArticle?.calculationRule?.type === "FIXED" && selectedArticle?.calculationRule?.fixedAmount
                    ? `₹${selectedArticle.calculationRule.fixedAmount}`
                    : selectedArticle?.calculationRule?.minAmount
                    ? `₹${selectedArticle.calculationRule.minAmount} (Minimum)`
                    : selectedArticle?.calculationRule?.percentage
                    ? `${selectedArticle.calculationRule.percentage}%`
                    : "As per State Rules"}
                </span>
                <span className="text-xs text-slate-600">
                  {selectedArticle ? `for ${selectedArticle.title} (${selectedArticle.articleCode})` : "for selected article"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Official stamp duty governed by state treasury regulations. The payer selected below will be designated as the compulsory duty remitter on the e-Stamp certificate.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Consideration Price (₹)" error={errors.considerationPrice?.message} hint="Enter 0 if document has no commercial consideration value">
                <input type="number" className="input" {...register("considerationPrice", { valueAsNumber: true })} />
              </Field>
              {values.firstParty || values.secondParty ? (
                <FieldGroup label="Stamp Duty Paid By *" error={errors.stampDutyPaidBy?.message}>
                  <div className="flex gap-2">
                    {values.firstParty && (
                      <button
                        type="button"
                        aria-pressed={paidBySide === "FIRST"}
                        onClick={() => choosePayer("FIRST")}
                        className={`px-3 py-2 rounded-lg border text-sm flex-1 text-left ${
                          paidBySide === "FIRST"
                            ? "border-brand-600 bg-brand-50 text-brand-700 font-medium"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {values.firstParty} (First Party)
                      </button>
                    )}
                    {values.secondParty && (
                      <button
                        type="button"
                        aria-pressed={paidBySide === "SECOND"}
                        onClick={() => choosePayer("SECOND")}
                        className={`px-3 py-2 rounded-lg border text-sm flex-1 text-left ${
                          paidBySide === "SECOND"
                            ? "border-brand-600 bg-brand-50 text-brand-700 font-medium"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {values.secondParty} (Second Party)
                      </button>
                    )}
                  </div>
                </FieldGroup>
              ) : (
                <Field label="Stamp Duty Paid By *" error={errors.stampDutyPaidBy?.message}>
                  <input className="input" {...register("stampDutyPaidBy")} placeholder="Enter party names on the previous step first" />
                </Field>
              )}
              <Field label="No. of E-Stamps" error={errors.numberOfEStamps?.message} hint="Default is 1 certificate copy">
                <input type="number" className="input" {...register("numberOfEStamps", { valueAsNumber: true })} />
              </Field>
            </div>
          </div>
        )}

        {step === REVIEW_STEP && (
          <ReviewStep
            values={values}
            calculation={isFresh ? calculation : null}
            balance={balance}
            canOpenWallet={canOpenWallet}
            articles={articles}
            states={states}
            calculating={calculating}
            calcError={calcError}
            onRetryCalculation={runCalculation}
            paidBySide={paidBySide}
          />
        )}

        <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="text-sm text-slate-600 border border-slate-300 rounded-lg px-4 py-2 disabled:opacity-40"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            // Distinct `key`s (rather than letting the ternary swap
            // type="button"/type="submit" on the SAME reused DOM node) -
            // without this, React reconciles both branches to one physical
            // <button> element in this slot, and a click that flips
            // type="button" -> type="submit" mid-event can have the browser's
            // native form-submission activation behavior run against the
            // now-mutated node, silently submitting the form on what the
            // user saw as a "Next" click (caught via real-browser QA, not by
            // the build or unit tests).
            <button key="next-btn" type="button" onClick={goNext} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
              Next
            </button>
          ) : (
            <button
              key="submit-btn"
              type="submit"
              disabled={
                submitting ||
                !isFresh ||
                !calculation ||
                calculation.amount <= 0 ||
                (calculation.pricing && calculation.pricing.stampDuty <= 0) ||
                (typeof balance === "number" &&
                  balance <
                    (calculation.pricing && typeof calculation.pricing.totalAmount === "number"
                      ? calculation.pricing.totalAmount
                      : calculation.amount))
              }
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Create Request"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Stepper({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 mb-4 text-xs">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`rounded-full px-3 py-1 font-medium ${
            i === step ? "bg-brand-600 text-white" : i < step ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function AddFundsHint({ canOpenWallet }) {
  return canOpenWallet ? (
    <span>
      <Link to="/wallet" className="font-medium underline">
        Add money to the wallet
      </Link>{" "}
      (payments are added to your balance once LauncherDesk confirms them, see{" "}
      <Link to="/payments" className="font-medium underline">
        Payments
      </Link>
      ).
    </span>
  ) : (
    <span>Ask your Super Admin to add funds.</span>
  );
}

function ReviewStep({ values, calculation, balance, canOpenWallet, articles, states, calculating, calcError, onRetryCalculation, paidBySide }) {
  const pricing = calculation?.pricing;
  const requiredAmount = pricing && typeof pricing.totalAmount === "number" ? pricing.totalAmount : (calculation ? calculation.amount : 0);
  const insufficientBalance = calculation && typeof balance === "number" && balance < requiredAmount;
  const selectedArticle = articles.find((a) => a._id === values.articleId);
  const selectedState = states.find((s) => s.code === values.stateCode);
  // A duty of exactly 0 means this article's rule is not configured, never
  // that the stamp is genuinely free - the engine deliberately refuses to
  // guess a legal amount. Shown as "At Actuals" (billed at the real
  // government charge) rather than a bare "₹0" that reads as a real price.
  const dutyNotConfigured = calculation && (calculation.amount === 0 || !pricing || pricing.stampDuty === 0);
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <Row label="First Party" value={values.firstParty} />
        <Row label="Second Party" value={values.secondParty} />
        <Row label="Description" value={values.descriptionOfDocument} />
        <Row label="Property Description" value={values.propertyDescription || "-"} />
        <Row label="State" value={selectedState ? selectedState.name : values.stateCode} />
        <Row label="Article" value={selectedArticle ? `${selectedArticle.articleCode} - ${selectedArticle.title}` : "-"} />
        <Row label="Stamp Duty" value={pricing && pricing.stampDuty !== 0 ? formatCurrency(pricing.stampDuty) : "At Actuals"} />
        {/* Names the party as well as the name, so a payer who shares a name
            with the other party is still unambiguous on the final check. */}
        <Row
          label="Stamp Duty Paid By"
          value={
            paidBySide
              ? `${values.stampDutyPaidBy} (${paidBySide === "FIRST" ? "First Party" : "Second Party"})`
              : values.stampDutyPaidBy
          }
        />
        <Row label="No. of E-Stamps" value={values.numberOfEStamps} />
      </div>

      <PriceSummary calculation={calculation} calculating={calculating} calcError={calcError} onRetry={onRetryCalculation} balance={balance} />

      {dutyNotConfigured && (
        <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2">
          This article has no fixed duty in the official rate list, so the stamp duty is shown "At Actuals" - it is billed at the real
          government charge rather than a guessed amount. Ask your Master Admin to set the rate for "
          {selectedArticle ? selectedArticle.title : "this article"}" if it should be a fixed figure.
        </div>
      )}

      {insufficientBalance && (
        <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2">
          Insufficient balance: this request needs {formatCurrency(requiredAmount)} but the available balance is {formatCurrency(balance)}.{" "}
          <AddFundsHint canOpenWallet={canOpenWallet} />
        </div>
      )}
    </div>
  );
}

// The published price breakdown, laid out like the public e-Stamp site's
// "Price summary" card. Every figure comes from the server's own pricing
// response - nothing is computed here - so the portal and the public site can
// never quote different numbers. An unknown government duty reads "At
// Actuals", but the total is always a real number - it only ever omits the
// still-unknown duty component, never the known, computable fee+GST portion.
function PriceSummary({ calculation, calculating, calcError, onRetry, balance }) {
  if (calcError) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
        <p className="text-red-700">{calcError}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium text-red-700 underline">
          Retry
        </button>
      </div>
    );
  }
  if (!calculation) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-slate-500">
        {calculating ? "Working out the price..." : "Preparing the price summary..."}
      </div>
    );
  }
  const pricing = calculation.pricing;
  if (!pricing) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
        <Row label="Stamp Duty to be Reserved" value={formatCurrency(calculation.amount)} />
        <Row label="Available Balance" value={formatCurrency(balance)} />
      </div>
    );
  }
  const atActuals = pricing.stampDuty === 0;
  const dutyDisplay = atActuals ? "At Actuals" : formatCurrency(pricing.stampDuty);
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
      <p className="font-medium text-slate-900 mb-2">Price summary</p>
      <Row label="Stamp duty" value={dutyDisplay} />
      <Row label="Convenience Fee" value={formatCurrency(pricing.convenienceFee)} />
      <Row label="Procurement Charge" value={formatCurrency(pricing.procurementFee)} />
      <Row label="GST (18%)" value={formatCurrency(pricing.gst)} />
      {/* The government stamp duty itself is always billed at the real,
          final government rate - never a figure LauncherDesk sets - so this
          disclosure always reads "At Actuals", independent of whether that
          rate happens to already be known (the "Stamp duty" row above). It
          previously reused dutyDisplay, which showed a second, duplicate
          currency figure instead of this disclosure once the duty WAS known. */}
      <Row label="Government Fees" value="At Actuals" />
      <div className="flex justify-between pt-2 mt-1 border-t border-slate-300">
        <span className="font-semibold text-slate-900">Total payable</span>
        <span className="font-semibold text-slate-900">{formatCurrency(pricing.totalAmount)}</span>
      </div>
      <p className="text-xs text-slate-500 pt-2">
        All taxes included. GST applies to the procurement charge only, not to the stamp duty or the convenience fee.
      </p>
      <div className="mt-2 pt-2 border-t border-slate-200">
        <Row label="Reserved from your balance now" value={formatCurrency(calculation.amount)} />
        <Row label="Available Balance" value={formatCurrency(balance)} />
        <p className="text-xs text-slate-500 pt-1">
          Only the stamp duty is reserved when you submit and charged when the 20-minute window ends. Fees are billed separately.
        </p>
      </div>
    </div>
  );
}

// A labelled group for controls that are not one form field. Deliberately
// NOT a <label>: a label adopts its first labelable descendant, so wrapping
// the two payer buttons in one overwrote the FIRST button's accessible name
// with the whole group's text - leaving a screen-reader user hearing the
// group heading where the first party's name should be.
function FieldGroup({ label, error, children }) {
  return (
    <div role="group" aria-label={label}>
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </div>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <div className="block">
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {children}
      </label>
      {hint && !error && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
