// Compatibility fixture for the dormant v81 points controller. Production now
// uses the visit-based v166 UI; this markup only exercises preserved v81 retry
// and idempotency guarantees while that backend remains available for rollback.
export const loyaltyV81PanelHtml = `
<section id="loyaltyPanel" hidden>
  <p id="loyaltyWorkflowStatus"></p><div id="loyaltyLoading" hidden></div>
  <div id="loyaltyUnavailable" hidden><span id="loyaltyUnavailableText"></span><button id="reloadLoyalty" type="button">Retry</button></div>
  <div id="loyaltyWorkspace" hidden>
    <input id="loyaltyEnabled" type="checkbox" data-loyalty-write>
    <form id="loyaltyRuleForm"><input id="loyaltyRuleName" value="Main"><input id="loyaltyEarnPercent" type="number" required><input id="loyaltyMinPaid" type="number" required><input id="loyaltyMaxRedeemPercent" type="number" required><p id="loyaltyRuleError" class="form-error" hidden></p><button type="submit" data-loyalty-write>Save</button></form>
    <div id="loyaltyActions"><div id="loyaltyBalancesList"></div>
      <details class="loyalty-operation"><form id="loyaltyAdjustmentForm"><select id="loyaltyAdjustmentClient" required></select><input id="loyaltyAdjustmentPoints" type="number" min="-1000000" max="1000000" required><input id="loyaltyAdjustmentReason" minlength="8" maxlength="500" required><p id="loyaltyAdjustmentError" class="form-error" hidden></p><button type="submit" data-loyalty-write>Adjust</button></form></details>
      <details class="loyalty-operation"><form id="loyaltyRedeemForm"><select id="loyaltyRedeemClient" required></select><select id="loyaltyRedeemBooking" required></select><input id="loyaltyRedeemPoints" type="number" min="1" max="10000000" required><p id="loyaltyRedeemError" class="form-error" hidden></p><button type="submit" data-loyalty-write>Redeem</button></form></details>
    </div>
    <div id="loyaltyPromotionsList"></div>
    <form id="loyaltyPromoForm"><input id="loyaltyPromoCode" required><select id="loyaltyPromoKind"><option value="percent">Percent</option><option value="fixed">Fixed</option></select><span id="loyaltyPromoValueLabel"></span><input id="loyaltyPromoValue" type="number" required><span id="loyaltyPromoValueHint"></span><input id="loyaltyPromoFrom" type="date" required><input id="loyaltyPromoUntil" type="date" required><input id="loyaltyPromoTotalLimit" type="number"><input id="loyaltyPromoClientLimit" type="number"><p id="loyaltyPromoError" class="form-error" hidden></p><button type="submit" data-loyalty-write>Create</button></form>
    <details><summary>Apply promotion</summary><form id="loyaltyPromoApplyForm"><select id="loyaltyPromoClient" required></select><select id="loyaltyPromoBooking" required></select><input id="loyaltyPromoApplyCode" required><p id="loyaltyPromoApplyError" class="form-error" hidden></p><button type="submit" data-loyalty-write>Apply</button></form></details>
    <div id="loyaltyLedgerList"></div><span id="loyaltyBonusExampleText"></span><span id="loyaltyRedeemExampleText"></span>
  </div>
</section>`;
