describe('E2E-003 search and filter', () => {
  beforeEach(() => {
    cy.visit('/login');
    cy.get('#email').type('qa@example.com');
    cy.get('#password').type('Passw0rd!');
    cy.get('.btn-primary').click();
  });

  it('filters by Done', () => {
    cy.get('[placeholder="Search"]').type('release');
    cy.get('select').select('Done');
    cy.get('.card').should('have.length', 1);
  });
});
