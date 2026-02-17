/**
 * RelationshipBuilder - Builds relationships between entities
 * 
 * Ensures referential integrity by linking entities together
 * according to defined relationship rules
 */

import logger from '../utils/logger.js';

class RelationshipBuilder {
  constructor(relationshipRules = {}) {
    this.relationshipRules = relationshipRules;
    this.entityMap = new Map(); // Store entities by type and ID
  }

  /**
   * Build relationships for a collection of entities
   * @param {Object} entities - Object with entity type as key and array of entities as value
   * @returns {Object} Entities with relationships established
   */
  buildRelationships(entities) {
    logger.info('Building relationships between entities...');

    // First pass: Index all entities by type and ID
    this._indexEntities(entities);

    // Second pass: Build relationships according to rules
    const linkedEntities = this._linkEntities(entities);

    // Third pass: Validate referential integrity
    const validation = this.validateIntegrity(linkedEntities);
    if (!validation.valid) {
      logger.warn('Referential integrity issues found:', validation.errors);
    }

    logger.info('Relationship building complete');
    return linkedEntities;
  }

  /**
   * Validate referential integrity of entities
   * @param {Object} entities - Entities to validate
   * @returns {Object} { valid: boolean, errors: Array }
   */
  validateIntegrity(entities) {
    const errors = [];

    for (const [entityType, entityArray] of Object.entries(entities)) {
      const rules = this.relationshipRules[entityType];
      if (!rules) continue;

      for (const entity of entityArray) {
        // Check required relationships
        if (rules.required) {
          for (const requiredField of rules.required) {
            if (!entity[requiredField] || entity[requiredField] === null) {
              errors.push({
                entityType,
                entityId: entity._id || entity.id,
                field: requiredField,
                message: `Required relationship field '${requiredField}' is missing or null`
              });
            }
          }
        }

        // Check foreign key references exist
        if (rules.references) {
          for (const [field, refType] of Object.entries(rules.references)) {
            const refId = entity[field];
            if (refId && !this._entityExists(refType, refId)) {
              errors.push({
                entityType,
                entityId: entity._id || entity.id,
                field,
                message: `Referenced ${refType} with ID ${refId} does not exist`
              });
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Resolve references for a single entity
   * @param {string} entityType - Type of entity
   * @param {Object} entity - Entity to resolve references for
   * @returns {Object} Entity with resolved references
   */
  resolveReferences(entityType, entity) {
    const rules = this.relationshipRules[entityType];
    if (!rules || !rules.references) {
      return entity;
    }

    const resolved = { ...entity };

    for (const [field, refType] of Object.entries(rules.references)) {
      const refId = entity[field];
      if (refId) {
        const referencedEntity = this._getEntity(refType, refId);
        if (referencedEntity) {
          resolved[`${field}_data`] = referencedEntity;
        }
      }
    }

    return resolved;
  }

  /**
   * Index all entities for quick lookup
   * @private
   */
  _indexEntities(entities) {
    this.entityMap.clear();

    for (const [entityType, entityArray] of Object.entries(entities)) {
      if (!Array.isArray(entityArray)) continue;

      const typeMap = new Map();
      for (const entity of entityArray) {
        const id = entity._id || entity.id;
        if (id) {
          typeMap.set(id, entity);
        }
      }
      this.entityMap.set(entityType, typeMap);
    }

    logger.debug(`Indexed ${this.entityMap.size} entity types`);
  }

  /**
   * Link entities according to relationship rules
   * @private
   */
  _linkEntities(entities) {
    const linked = {};

    // Process entities in dependency order
    const processingOrder = this._getProcessingOrder(entities);

    for (const entityType of processingOrder) {
      const entityArray = entities[entityType];
      if (!Array.isArray(entityArray)) continue;

      linked[entityType] = entityArray.map(entity => {
        return this._linkEntity(entityType, entity, entities);
      });
    }

    return linked;
  }

  /**
   * Link a single entity
   * @private
   */
  _linkEntity(entityType, entity, allEntities) {
    const rules = this.relationshipRules[entityType];
    if (!rules) return entity;

    const linked = { ...entity };

    // Handle one-to-one relationships
    if (rules.oneToOne) {
      for (const [field, config] of Object.entries(rules.oneToOne)) {
        const targetType = config.type;
        const targetEntities = allEntities[targetType];
        
        if (targetEntities && targetEntities.length > 0) {
          // Pick a random entity or use specified logic
          const targetEntity = this._selectRelatedEntity(targetEntities, config);
          if (targetEntity) {
            linked[field] = targetEntity._id || targetEntity.id;
          }
        }
      }
    }

    // Handle many-to-one relationships
    if (rules.manyToOne) {
      for (const [field, config] of Object.entries(rules.manyToOne)) {
        const targetType = config.type;
        const targetEntities = allEntities[targetType];
        
        if (targetEntities && targetEntities.length > 0) {
          const targetEntity = this._selectRelatedEntity(targetEntities, config);
          if (targetEntity) {
            linked[field] = targetEntity._id || targetEntity.id;
          }
        }
      }
    }

    // Handle one-to-many relationships
    if (rules.oneToMany) {
      for (const [field, config] of Object.entries(rules.oneToMany)) {
        const targetType = config.type;
        const targetEntities = allEntities[targetType];
        
        if (targetEntities && targetEntities.length > 0) {
          const count = config.count || { min: 1, max: 5 };
          const selectedCount = this._randomInt(count.min, count.max);
          const selectedEntities = this._selectMultipleRelatedEntities(
            targetEntities,
            selectedCount,
            config
          );
          linked[field] = selectedEntities.map(e => e._id || e.id);
        }
      }
    }

    return linked;
  }

  /**
   * Select a related entity based on configuration
   * @private
   */
  _selectRelatedEntity(entities, config) {
    if (config.selector) {
      return config.selector(entities);
    }
    // Default: random selection
    return entities[Math.floor(Math.random() * entities.length)];
  }

  /**
   * Select multiple related entities
   * @private
   */
  _selectMultipleRelatedEntities(entities, count, config) {
    const selected = [];
    const available = [...entities];
    
    for (let i = 0; i < Math.min(count, available.length); i++) {
      const index = Math.floor(Math.random() * available.length);
      selected.push(available[index]);
      available.splice(index, 1); // Remove to avoid duplicates
    }
    
    return selected;
  }

  /**
   * Get processing order based on dependencies
   * @private
   */
  _getProcessingOrder(entities) {
    const entityTypes = Object.keys(entities);
    const order = [];
    const processed = new Set();

    // Simple dependency resolution (can be enhanced with topological sort)
    // Process entities with no dependencies first
    const noDeps = entityTypes.filter(type => {
      const rules = this.relationshipRules[type];
      return !rules || !rules.dependsOn || rules.dependsOn.length === 0;
    });

    order.push(...noDeps);
    processed.add(...noDeps);

    // Process remaining entities
    let remaining = entityTypes.filter(type => !processed.has(type));
    let iterations = 0;
    const maxIterations = entityTypes.length * 2;

    while (remaining.length > 0 && iterations < maxIterations) {
      for (const type of remaining) {
        const rules = this.relationshipRules[type];
        const deps = rules?.dependsOn || [];
        
        // Check if all dependencies are processed
        const allDepsProcessed = deps.every(dep => processed.has(dep));
        
        if (allDepsProcessed) {
          order.push(type);
          processed.add(type);
        }
      }
      
      remaining = entityTypes.filter(type => !processed.has(type));
      iterations++;
    }

    // Add any remaining (circular dependencies or no rules)
    remaining.forEach(type => {
      if (!order.includes(type)) {
        order.push(type);
      }
    });

    return order;
  }

  /**
   * Check if an entity exists
   * @private
   */
  _entityExists(entityType, entityId) {
    const typeMap = this.entityMap.get(entityType);
    return typeMap && typeMap.has(entityId);
  }

  /**
   * Get an entity by type and ID
   * @private
   */
  _getEntity(entityType, entityId) {
    const typeMap = this.entityMap.get(entityType);
    return typeMap ? typeMap.get(entityId) : null;
  }

  /**
   * Generate random integer
   * @private
   */
  _randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Add relationship rule
   * @param {string} entityType - Entity type
   * @param {Object} rules - Relationship rules
   */
  addRelationshipRule(entityType, rules) {
    this.relationshipRules[entityType] = rules;
  }

  /**
   * Get relationship rules for entity type
   * @param {string} entityType - Entity type
   * @returns {Object} Relationship rules
   */
  getRelationshipRules(entityType) {
    return this.relationshipRules[entityType] || null;
  }
}

export default RelationshipBuilder;
