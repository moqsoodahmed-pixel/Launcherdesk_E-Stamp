import { Loader2, ReceiptText, Stamp, Users, Wallet } from "lucide-react";
import Toast from "../../components/ui/Toast";
import SharedStepper from "../../components/ui/Stepper";
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

  useEffect(() => {
    if (!values.stateCode) {
      setArticles([]);
      return;
    }
    const cached = articlesCacheRef.current.get(values.stateCode);
    if (cached) {
      setArticles(cached);
      return;
    }
    setArticlesLoading(true);
    apiClient
      .get("/articles", { params: { stateCode: values.stateCode } })
      .then((res) => {
        const payload = res.data.data;
        const items = Array.isArray(payload) ? payload : payload?.items || [];
        articlesCacheRef.current.set(values.stateCode, items);
        setArticles(items);
      })
      .catch((err) => {
        setArticles([]);
        setLookupError(errorMessage(err, "Could not load articles for this state."));
      })
      .finally(() => setArticlesLoading(false));
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-slate-900">Create E-Stamp Request</h1>
        {balance !== null && (
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
            <Wallet size={16} className="text-brand-700" aria-hidden="true" />
            Available balance: <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(balance)}</span>
          </div>
        )}
      </div>

      <p className="mb-6 text-sm text-slate-600">
        Need to create many at once?{" "}
        <Link to="/estamps/bulk" className="font-medium text-brand-700 hover:underline">
          Use Bulk E-Stamp
        </Link>
        .
      </p>

      <Stepper step={step} />

      {serverError && (
        <Toast tone="error" className="mb-4" onClose={() => setServerError(null)} closeLabel="Dismiss error">
          {serverError}
        </Toast>
      )}
      {lookupError && (
        <Toast tone="error" className="mb-4" onClose={() => setLookupError(null)} closeLabel="Dismiss lookup error">
          {lookupError}
        </Toast>
      )}
      {balance === 0 && !serverError && (
        <Toast tone="warning" className="mb-4">
          Your organization's available balance is ₹0. This request will be rejected unless funds are added first. <AddFundsHint canOpenWallet={canOpenWallet} />
        </Toast>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5 p-5 sm:p-6">
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
              <Toast tone="warning">
                <strong>Notice:</strong> First Party and Second Party names are identical ("{values.firstParty.trim()}"). Ensure this is intentional for self-declarations or unilateral affidavits.
              </Toast>
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
            <Field
              label={values.stateCode && articles.length > 0 ? `Article (${articles.length} available)` : "Article"}
              error={errors.articleId?.message}
            >
              <select className="input" {...register("articleId")} disabled={!values.stateCode}>
                <option value="">Select article</option>
                {articles.map((a, idx) => (
                  <option key={a._id} value={a._id}>
                    {idx + 1}. {a.articleCode} - {a.title}
                  </option>
                ))}
              </select>
              {values.stateCode && !articlesLoading && articles.length === 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  No official articles have been imported for this state yet.
                </p>
              )}
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Consideration Price (₹)" error={errors.considerationPrice?.message} hint="Enter 0 if document has no commercial consideration value">
              <input type="number" className="input" {...register("considerationPrice", { valueAsNumber: true })} />
            </Field>
            {values.firstParty || values.secondParty ? (
              <FieldGroup label="Who pays the stamp duty?" error={errors.stampDutyPaidBy?.message}>
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
              <Field label="Who pays the stamp duty?" error={errors.stampDutyPaidBy?.message}>
                <input className="input" {...register("stampDutyPaidBy")} placeholder="Enter party names on the previous step first" />
              </Field>
            )}
            <Field label="No. of E-Stamps" error={errors.numberOfEStamps?.message} hint="Default is 1 certificate copy">
              <input type="number" className="input" {...register("numberOfEStamps", { valueAsNumber: true })} />
            </Field>
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

        <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex items-center justify-between rounded-b-card border-t border-slate-200 bg-white px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 sm:min-h-[40px]"
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
            <button key="next-btn" type="button" onClick={goNext} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700">
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
              className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
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
  return <SharedStepper steps={STEPS} current={step} label="Request steps" className="mb-6" numbered />;
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
    <div className="space-y-6 text-sm">
      <p className="text-slate-600">Check the details below before you submit.</p>
      <ReviewGroup title="Agreement" icon={Users}>
        <Row label="First Party" value={values.firstParty} />
        <Row label="Second Party" value={values.secondParty} />
        <Row label="Description" value={values.descriptionOfDocument} />
        <Row label="Property Description" value={values.propertyDescription || "-"} />
      </ReviewGroup>
      <ReviewGroup title="Stamp" icon={Stamp}>
        <Row label="State" value={selectedState ? selectedState.name : values.stateCode} />
        <Row label="Article" value={selectedArticle ? `${selectedArticle.articleCode} - ${selectedArticle.title}` : "-"} />
        <Row label="Consideration Price" value={<span className="tabular-nums">{formatCurrency(values.considerationPrice)}</span>} />
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
      </ReviewGroup>

      <PriceSummary calculation={calculation} calculating={calculating} calcError={calcError} onRetry={onRetryCalculation} balance={balance} />

      {dutyNotConfigured && (
        <Toast tone="warning">
          This article has no fixed duty in the official rate list, so the stamp duty is shown "At Actuals" - it is billed at the real
          government charge rather than a guessed amount. Ask your Master Admin to set the rate for "
          {selectedArticle ? selectedArticle.title : "this article"}" if it should be a fixed figure.
        </Toast>
      )}

      {insufficientBalance && (
        <Toast tone="error">
          Insufficient balance: this request needs {formatCurrency(requiredAmount)} but the available balance is {formatCurrency(balance)}.{" "}
          <AddFundsHint canOpenWallet={canOpenWallet} />
        </Toast>
      )}
    </div>
  );
}

function ReviewGroup({ title, icon: IconCmp, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <IconCmp size={16} className="text-slate-500" aria-hidden="true" />
        {title}
      </h3>
      <div className="rounded-lg border border-slate-200 px-4 py-3">{children}</div>
    </section>
  );
}

// The published price breakdown, laid out like the public e-Stamp site's
// "Price summary" card. Every figure comes from the server's own pricing
// response - nothing is computed here - so the portal and the public site can
// never quote different numbers. An unknown government charge reads "At
// Actuals" and the total stays "-" rather than being invented.
function PriceSummary({ calculation, calculating, calcError, onRetry, balance }) {
  if (calcError) {
    return (
      <div className="rounded-lg border border-vermilion-200 bg-vermilion-50 px-4 py-3">
        <p className="text-vermilion-800">{calcError}</p>
        <button type="button" onClick={onRetry} className="mt-2 min-h-[36px] text-sm font-medium text-vermilion-700 underline">
          Retry
        </button>
      </div>
    );
  }
  if (!calculation) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        {calculating ? "Working out the price..." : "Preparing the price summary..."}
      </div>
    );
  }
  const pricing = calculation.pricing;
  if (!pricing) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <Row label="Stamp Duty to be Reserved" value={formatCurrency(calculation.amount)} />
        <Row label="Available Balance" value={formatCurrency(balance)} />
      </div>
    );
  }
  const atActuals = pricing.stampDuty === 0;
  const dutyDisplay = atActuals ? "At Actuals" : formatCurrency(pricing.stampDuty);
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ReceiptText size={16} className="text-slate-500" aria-hidden="true" />
        Price summary
      </h3>
      <Row label="Stamp duty" value={dutyDisplay} />
      <Row label="Convenience Fee" value={formatCurrency(pricing.convenienceFee)} />
      <Row label="Procurement Charge" value={formatCurrency(pricing.procurementFee)} />
      <Row label="GST (18%)" value={formatCurrency(pricing.gst)} />
      <Row label="Government Fees" value={dutyDisplay} />
      <div className="mt-2 flex items-baseline justify-between border-t border-slate-300 pt-3">
        <span className="font-semibold text-slate-900">Total payable</span>
        <span className="font-display text-2xl font-semibold text-slate-900 tabular-nums">{pricing.totalAmount === null ? "-" : formatCurrency(pricing.totalAmount)}</span>
      </div>
      <p className="text-xs text-slate-500 pt-2">
        All taxes included. GST applies to the fees, not to the government stamp duty.
      </p>
      <div className="mt-2 pt-2 border-t border-slate-200">
        <Row label="Reserved from your balance now" value={formatCurrency(calculation.amount)} />
        <Row label="Available Balance" value={formatCurrency(balance)} />
        <p className="text-xs text-slate-500 pt-1">
          Only the stamp duty is reserved when you submit and charged when the 20-minute window ends. Fees are billed separately.
        </p>
      </div>
    </section>
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
      <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-vermilion-700">{error}</span>}
    </div>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
        {children}
      </label>
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-vermilion-700">{error}</span>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-200/70 py-2 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}
