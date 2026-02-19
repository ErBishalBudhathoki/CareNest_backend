/**
 * Factory Index - Central export for all entity factories
 * 
 * Exports all factories and provides a convenience function to register them
 */

import FactoryRegistry from './FactoryRegistry.js';
import UserFactory from './UserFactory.js';
import ClientFactory from './ClientFactory.js';
import ShiftFactory from './ShiftFactory.js';
import InvoiceFactory from './InvoiceFactory.js';
import CarePlanFactory from './CarePlanFactory.js';
import TimesheetFactory from './TimesheetFactory.js';
import ExpenseFactory from './ExpenseFactory.js';
import OrganizationFactory from './OrganizationFactory.js';
import AuthFactory from './AuthFactory.js';

let registryInstance = null;

function getInstance() {
  if (!registryInstance) {
    registryInstance = new FactoryRegistry();
  }
  return registryInstance;
}

function registerAllFactories(registry = getInstance()) {
  registry.register('organization', new OrganizationFactory());
  registry.register('user', new UserFactory());
  registry.register('client', new ClientFactory());
  registry.register('shift', new ShiftFactory());
  registry.register('invoice', new InvoiceFactory());
  registry.register('carePlan', new CarePlanFactory());
  registry.register('timesheet', new TimesheetFactory());
  registry.register('expense', new ExpenseFactory());
  registry.register('auth', new AuthFactory());
  
  return registry;
}

export {
  FactoryRegistry,
  getInstance,
  registerAllFactories,
  UserFactory,
  ClientFactory,
  ShiftFactory,
  InvoiceFactory,
  CarePlanFactory,
  TimesheetFactory,
  ExpenseFactory,
  OrganizationFactory,
  AuthFactory
};

export default {
  FactoryRegistry,
  getInstance,
  registerAllFactories,
  UserFactory,
  ClientFactory,
  ShiftFactory,
  InvoiceFactory,
  CarePlanFactory,
  TimesheetFactory,
  ExpenseFactory,
  OrganizationFactory,
  AuthFactory
};
