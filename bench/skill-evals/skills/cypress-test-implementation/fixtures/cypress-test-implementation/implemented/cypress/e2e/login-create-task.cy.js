describe('E2E-001 login and create task', () => {
  let createdTitle;

  it('logs in', () => {
    cy.visit('/login');
    cy.get('#email').type('qa@example.com');
    cy.get('#password').type('Passw0rd!');
    cy.get('.btn-primary').click();
    cy.wait(5000);
    cy.get('h1').should('exist');
  });

  it('creates a task', () => {
    createdTitle = 'Write release notes';
    cy.get('.btn-new').click();
    cy.get('input').first().type(createdTitle);
    cy.get('button').contains('Save').click();
    cy.wait(3000);
    cy.get('.card').should('exist');
  });

  it('dismisses the onboarding modal if shown', () => {
    cy.get('body').then(($body) => {
      if ($body.find('.modal').length > 0) {
        cy.get('.modal .close').click();
      }
    });
  });
});
